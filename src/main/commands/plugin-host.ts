import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { createContext, runInContext, type Context } from 'node:vm'
import type { PluginInfo } from '@shared/ipc'
import {
  MAX_COMMAND_RESULT_LENGTH,
  MAX_PLUGIN_FILE_BYTES,
  PLUGIN_LOAD_TIMEOUT_MS,
  PLUGIN_TIMEOUT_MS
} from '@shared/constants'
import { CommandError, type LoadedPlugin, type PluginCommandContext } from './types'
import { asciiLowerCase } from './parser'

interface PluginSandbox {
  context: Context
  module: { exports: unknown }
}

interface PluginExports {
  name?: unknown
  commands?: unknown
}

export interface PluginBundle {
  plugins: LoadedPlugin[]
  infos: PluginInfo[]
}

export interface PluginHostOptions {
  loadTimeoutMs?: number
  executeTimeoutMs?: number
  maxFileBytes?: number
  maxOutputLength?: number
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  return (
    candidate.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ||
    (typeof candidate.message === 'string' && /timed out|timeout/i.test(candidate.message))
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return truncate(error.message)
  return truncate(String(error))
}

function validateExports(
  exported: unknown,
  file: string
): {
  name: string
  commands: Record<string, (...args: unknown[]) => unknown>
} {
  if (!exported || typeof exported !== 'object' || Array.isArray(exported)) {
    throw new Error('插件必须通过 module.exports 导出一个对象')
  }

  const candidate = exported as PluginExports
  const commandsValue = candidate.commands
  if (!commandsValue || typeof commandsValue !== 'object' || Array.isArray(commandsValue)) {
    throw new Error('插件必须导出 commands 对象')
  }

  const commandEntries = Object.entries(commandsValue as Record<string, unknown>)
  if (commandEntries.length === 0) {
    throw new Error('插件 commands 不能为空')
  }

  const commands: Record<string, (...args: unknown[]) => unknown> = {}
  for (const [rawName, value] of commandEntries) {
    if (!rawName || /\s/.test(rawName)) {
      throw new Error('插件命令名不能为空或包含空白')
    }
    const normalized = asciiLowerCase(rawName)
    if (normalized in commands) {
      throw new Error(`插件命令名重复：${rawName}`)
    }
    if (typeof value !== 'function') {
      throw new Error(`插件命令 ${rawName} 必须是函数`)
    }
    commands[normalized] = value as (...args: unknown[]) => unknown
  }

  const name =
    typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name.trim()
      : basename(file, extname(file))

  return { name, commands }
}

function executeSandboxCommand(
  sandbox: PluginSandbox,
  file: string,
  command: string,
  args: string[],
  context: PluginCommandContext,
  options: Required<Pick<PluginHostOptions, 'executeTimeoutMs' | 'maxOutputLength'>>
): string {
  const argsLiteral = JSON.stringify(args)
  const contextLiteral = JSON.stringify(context)
  const commandLiteral = JSON.stringify(asciiLowerCase(command))
  const source = `(function () {
    var fn = __pluginCommands[${commandLiteral}];
    if (typeof fn !== 'function') {
      __pluginOutcome = { kind: 'missing' };
      return;
    }
    var args = ${argsLiteral};
    var ctx = ${contextLiteral};
    var value = fn(args, ctx);
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof value.then === 'function'
    ) {
      try { value.catch(function () {}); } catch (error) {}
      __pluginOutcome = { kind: 'promise' };
      return;
    }
    if (typeof value !== 'string') {
      __pluginOutcome = { kind: 'type', valueType: typeof value };
      return;
    }
    __pluginOutcome = { kind: 'string', value: value };
  })()`

  let outcome: { kind?: unknown; value?: unknown; valueType?: unknown }
  try {
    runInContext(source, sandbox.context, {
      timeout: options.executeTimeoutMs,
      filename: file,
      displayErrors: false
    })
    outcome =
      (sandbox.context as unknown as { __pluginOutcome?: typeof outcome }).__pluginOutcome ?? {}
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new CommandError('PLUGIN_TIMEOUT', '插件执行超时')
    }
    throw new CommandError('PLUGIN_ERROR', '插件执行失败', errorMessage(error))
  }

  if (outcome.kind === 'missing') {
    throw new CommandError('PLUGIN_ERROR', '插件命令不存在')
  }
  if (outcome.kind === 'promise') {
    throw new CommandError('ASYNC_NOT_SUPPORTED', '不支持异步命令')
  }
  if (outcome.kind === 'type') {
    throw new CommandError('INVALID_RESULT', '命令必须返回文本')
  }
  if (outcome.kind !== 'string' || typeof outcome.value !== 'string') {
    throw new CommandError('INVALID_RESULT', '命令必须返回文本')
  }

  if (outcome.value.length > options.maxOutputLength) {
    throw new CommandError('INVALID_RESULT', '命令结果过长')
  }
  if (outcome.value.trim().length === 0) {
    throw new CommandError('INVALID_RESULT', '命令必须返回非空文本')
  }
  return outcome.value
}

async function loadPluginFile(
  directory: string,
  file: string,
  options: Required<PluginHostOptions>
): Promise<LoadedPlugin> {
  const fullPath = join(directory, file)
  const source = await readFile(fullPath, 'utf8')
  if (Buffer.byteLength(source, 'utf8') > options.maxFileBytes) {
    throw new Error('插件文件超过 1 MiB 限制')
  }

  const context = createContext({})
  const module = { exports: {} as unknown }
  ;(context as unknown as { __pluginModule: typeof module }).__pluginModule = module

  const wrapper = `(function (module, exports) {\n${source}\n})(__pluginModule, __pluginModule.exports)`
  try {
    runInContext(wrapper, context, {
      timeout: options.loadTimeoutMs,
      filename: fullPath,
      displayErrors: false
    })
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error('插件加载超时', { cause: error })
    }
    throw new Error(`插件加载失败：${errorMessage(error)}`, { cause: error })
  }

  const { name, commands } = validateExports(module.exports, file)
  ;(context as unknown as { __pluginCommands: typeof commands }).__pluginCommands = commands
  const sandbox: PluginSandbox = { context, module }

  return {
    file,
    name,
    commands: Object.keys(commands).sort(),
    execute(command, args, pluginContext) {
      return executeSandboxCommand(sandbox, fullPath, command, args, pluginContext, {
        executeTimeoutMs: options.executeTimeoutMs,
        maxOutputLength: options.maxOutputLength
      })
    }
  }
}

export class PluginHost {
  private readonly options: Required<PluginHostOptions>

  constructor(
    readonly directory: string,
    options: PluginHostOptions = {}
  ) {
    this.options = {
      loadTimeoutMs: options.loadTimeoutMs ?? PLUGIN_LOAD_TIMEOUT_MS,
      executeTimeoutMs: options.executeTimeoutMs ?? PLUGIN_TIMEOUT_MS,
      maxFileBytes: options.maxFileBytes ?? MAX_PLUGIN_FILE_BYTES,
      maxOutputLength: options.maxOutputLength ?? MAX_COMMAND_RESULT_LENGTH
    }
  }

  async load(): Promise<PluginBundle> {
    let entries: string[]
    try {
      const directoryEntries = await readdir(this.directory, { withFileTypes: true })
      entries = directoryEntries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => ['.js', '.cjs'].includes(extname(name).toLowerCase()))
        .sort((left, right) => left.localeCompare(right))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { plugins: [], infos: [] }
      }
      throw error
    }

    const plugins: LoadedPlugin[] = []
    const infos: PluginInfo[] = []

    for (const file of entries) {
      try {
        const plugin = await loadPluginFile(this.directory, file, this.options)
        plugins.push(plugin)
        infos.push({
          file,
          name: plugin.name,
          commands: plugin.commands
        })
      } catch (error) {
        infos.push({
          file,
          name: basename(file, extname(file)),
          commands: [],
          error: errorMessage(error)
        })
      }
    }

    return { plugins, infos }
  }
}
