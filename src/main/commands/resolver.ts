import { appError, type AppErrorInfo } from '@shared/errors'
import { MAX_COMMAND_RESULT_LENGTH } from '@shared/constants'
import { CommandParseError, parseCommand } from './parser'
import type { CommandRegistry } from './registry'
import { CommandError, type CommandResult, type ResolveOptions } from './types'

function duration(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function errorInfo(
  error: unknown,
  fallbackCode: 'INVALID_RESULT' | 'PLUGIN_ERROR' | 'UNKNOWN'
): AppErrorInfo {
  if (error instanceof CommandError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    }
  }
  if (error instanceof CommandParseError) {
    return { code: 'INVALID_ARGS', message: error.message }
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error)
  }
}

function normalizeText(
  text: unknown
): { ok: true; text: string } | { ok: false; error: AppErrorInfo } {
  if (typeof text !== 'string') {
    return { ok: false, error: appError('INVALID_RESULT', '命令必须返回文本') }
  }
  if (text.length > MAX_COMMAND_RESULT_LENGTH) {
    return { ok: false, error: appError('INVALID_RESULT', '命令结果过长') }
  }
  if (text.trim().length === 0) {
    return { ok: false, error: appError('INVALID_RESULT', '命令必须返回非空文本') }
  }
  return { ok: true, text }
}

export class CommandResolver {
  constructor(private readonly registry: CommandRegistry) {}

  resolve(input: string, options: ResolveOptions = {}): CommandResult {
    const startedAt = Date.now()

    let parsed
    try {
      parsed = parseCommand(input)
    } catch (error) {
      return {
        ok: false,
        error: errorInfo(error, 'INVALID_RESULT'),
        durationMs: duration(startedAt)
      }
    }

    if (!parsed) {
      return {
        ok: false,
        error: appError('INVALID_ARGS', '请输入命令'),
        durationMs: duration(startedAt)
      }
    }

    const lookup = this.registry.find(parsed.name)
    if (!lookup) {
      return {
        ok: false,
        command: parsed.name,
        error: appError('COMMAND_NOT_FOUND', `未找到命令：${parsed.name}`),
        durationMs: duration(startedAt)
      }
    }

    const now = options.now ?? new Date()
    const context = {
      rawArgs: parsed.rawArgs,
      now,
      locale: options.locale ?? 'zh-CN',
      randomUUID: options.randomUUID
    }

    try {
      let text: unknown

      if (lookup.source === 'alias') {
        if (parsed.args.length > 0) {
          throw new CommandError('INVALID_ARGS', `命令 ${lookup.name} 不接受参数`)
        }
        text = lookup.aliasValue
      } else if (lookup.source === 'plugin') {
        if (!lookup.plugin) {
          throw new CommandError('PLUGIN_ERROR', '插件不可用')
        }
        text = lookup.plugin.execute(lookup.name, parsed.args, {
          rawArgs: parsed.rawArgs,
          now: now.toISOString(),
          locale: context.locale
        })
      } else if (lookup.builtin) {
        text = lookup.builtin.execute(parsed.args, context)
      } else {
        throw new CommandError('COMMAND_NOT_FOUND', `未找到命令：${parsed.name}`)
      }

      const normalized = normalizeText(text)
      if (!normalized.ok) {
        return {
          ok: false,
          command: parsed.name,
          source: lookup.source,
          ...(lookup.plugin ? { plugin: lookup.plugin.name } : {}),
          error: normalized.error,
          durationMs: duration(startedAt)
        }
      }

      return {
        ok: true,
        command: parsed.name,
        source: lookup.source,
        ...(lookup.plugin ? { plugin: lookup.plugin.name } : {}),
        text: normalized.text,
        durationMs: duration(startedAt)
      }
    } catch (error) {
      return {
        ok: false,
        command: parsed.name,
        source: lookup.source,
        ...(lookup.plugin ? { plugin: lookup.plugin.name } : {}),
        error: errorInfo(error, lookup.source === 'plugin' ? 'PLUGIN_ERROR' : 'UNKNOWN'),
        durationMs: duration(startedAt)
      }
    }
  }
}
