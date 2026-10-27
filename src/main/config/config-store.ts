import { chmod, mkdir, readFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import {
  aliasSchema,
  appConfigSchema,
  createDefaultConfig,
  insertModeSchema,
  type Alias,
  type AppConfig
} from '@shared/config'
import { migrateRawConfig } from './migrations'
import { generatePairingToken } from './token'

export type ConfigStatus = 'ok' | 'created' | 'partial' | 'recovered'

export interface ConfigLoadResult {
  config: AppConfig
  status: ConfigStatus
  warnings: string[]
  backupPath?: string
}

export interface ConfigStoreOptions {
  now?: () => Date
  generateToken?: () => string
}

function configWarnings(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'config'
    return `${path}: ${issue.message}`
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 256
}

function salvageAliases(value: unknown, warnings: string[]): Alias[] {
  if (!Array.isArray(value)) {
    warnings.push('aliases 必须是数组，已回退为空列表')
    return []
  }

  const aliases: Alias[] = []
  const names = new Set<string>()
  const ids = new Set<string>()

  for (const [index, item] of value.entries()) {
    const parsed = aliasSchema.safeParse(item)
    if (!parsed.success) {
      warnings.push(`命令映射 #${index + 1} 无效，已忽略`)
      continue
    }

    const alias = parsed.data
    const normalized = alias.command.toLowerCase()
    if (names.has(normalized)) {
      warnings.push(`命令映射 #${index + 1} 命令名重复，已忽略`)
      continue
    }
    if (ids.has(alias.id)) {
      warnings.push(`命令映射 #${index + 1} id 重复，已忽略`)
      continue
    }

    names.add(normalized)
    ids.add(alias.id)
    aliases.push(alias)
  }

  return aliases
}

export function salvageConfig(
  raw: Record<string, unknown>,
  defaultToken: string
): {
  config: AppConfig
  warnings: string[]
} {
  const defaults = createDefaultConfig(defaultToken)
  const warnings: string[] = []
  const config: AppConfig = { ...defaults }

  if (typeof raw.onboardingComplete === 'boolean') {
    config.onboardingComplete = raw.onboardingComplete
  } else {
    warnings.push('onboardingComplete 非法，已使用默认值')
  }

  if (typeof raw.hotkey === 'string' && raw.hotkey.trim().length > 0) {
    config.hotkey = raw.hotkey
  } else {
    warnings.push('hotkey 非法，已使用默认值')
  }

  const insertMode = insertModeSchema.safeParse(raw.insertMode)
  if (insertMode.success) {
    config.insertMode = insertMode.data
  } else {
    warnings.push('insertMode 非法，已使用默认值')
  }

  if (typeof raw.launchAtLogin === 'boolean') {
    config.launchAtLogin = raw.launchAtLogin
  } else {
    warnings.push('launchAtLogin 非法，已使用默认值')
  }

  if (isRecord(raw.server) && isToken(raw.server.token)) {
    config.server = { token: raw.server.token }
  } else {
    warnings.push('配对令牌非法，已生成新令牌')
  }

  config.aliases = salvageAliases(raw.aliases, warnings)

  if (isRecord(raw.plugins) && typeof raw.plugins.enabled === 'boolean') {
    config.plugins = { enabled: raw.plugins.enabled }
  } else {
    warnings.push('plugins 配置非法，已使用默认值')
  }

  return { config, warnings }
}

export class ConfigStore {
  private readonly now: () => Date
  private readonly newToken: () => string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    readonly configPath: string,
    options: ConfigStoreOptions = {}
  ) {
    this.now = options.now ?? (() => new Date())
    this.newToken = options.generateToken ?? generatePairingToken
  }

  async load(): Promise<ConfigLoadResult> {
    let text: string
    try {
      text = await readFile(this.configPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.createDefault('created', [])
      }
      return this.createDefault('recovered', [
        `无法读取配置文件：${error instanceof Error ? error.message : String(error)}`
      ])
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return this.backupAndReset('配置文件不是合法 JSON，已备份并恢复默认配置')
    }

    if (!isRecord(parsed)) {
      return this.backupAndReset('配置文件根节点必须是对象，已备份并恢复默认配置')
    }

    const migrated = migrateRawConfig(parsed)
    if (migrated.unsupported) {
      return this.backupAndReset(
        `${migrated.warnings.join('；') || '配置版本不受支持'}，已备份并恢复默认配置`
      )
    }

    const validated = appConfigSchema.safeParse(migrated.raw)
    if (validated.success) {
      if (migrated.warnings.length > 0) {
        await this.safeSave(validated.data, migrated.warnings)
        return {
          config: validated.data,
          status: 'partial',
          warnings: migrated.warnings
        }
      }
      return { config: validated.data, status: 'ok', warnings: [] }
    }

    const salvaged = salvageConfig(migrated.raw, this.newToken())
    const warnings = [
      ...migrated.warnings,
      ...configWarnings(validated.error),
      ...salvaged.warnings
    ]
    await this.safeSave(salvaged.config, warnings)
    return { config: salvaged.config, status: 'partial', warnings }
  }

  async save(config: AppConfig): Promise<void> {
    const validated = appConfigSchema.parse(config)
    const write = this.writeQueue.then(() => this.writeConfig(validated))
    this.writeQueue = write.catch(() => undefined)
    return write
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private async createDefault(
    status: 'created' | 'recovered',
    warnings: string[]
  ): Promise<ConfigLoadResult> {
    const config = createDefaultConfig(this.newToken())
    const nextWarnings = [...warnings]
    await this.safeSave(config, nextWarnings)
    return { config, status, warnings: nextWarnings }
  }

  private async backupAndReset(reason: string): Promise<ConfigLoadResult> {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-')
    const backupPath = join(dirname(this.configPath), `config.corrupt-${stamp}.json`)
    try {
      await rename(this.configPath, backupPath)
    } catch (error) {
      const warnings = [
        `${reason}；无法备份原文件：${error instanceof Error ? error.message : String(error)}`
      ]
      return {
        config: createDefaultConfig(this.newToken()),
        status: 'recovered',
        warnings
      }
    }

    const config = createDefaultConfig(this.newToken())
    const warnings = [reason]
    await this.safeSave(config, warnings)
    return { config, status: 'recovered', warnings, backupPath }
  }

  private async safeSave(config: AppConfig, warnings: string[]): Promise<void> {
    try {
      await this.save(config)
    } catch (error) {
      warnings.push(`配置文件写入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async writeConfig(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFileAtomic(this.configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      fsync: true
    })
    if (process.platform !== 'win32') {
      await chmod(this.configPath, 0o600)
    }
  }
}
