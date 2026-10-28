export const CURRENT_CONFIG_VERSION = 2

export type RawConfig = Record<string, unknown>

export interface MigrationResult {
  raw: RawConfig
  warnings: string[]
  unsupported: boolean
}

type Migration = (raw: RawConfig) => RawConfig

/**
 * Migration entry point. v1 is the first released schema; future versions can
 * be added here and applied in order.
 */
export const configMigrations: Record<number, Migration> = {
  1: (raw) => ({
    ...raw,
    version: 2,
    folders: Array.isArray(raw.folders) ? raw.folders : [],
    aliases: Array.isArray(raw.aliases)
      ? raw.aliases.map((alias) =>
          alias && typeof alias === 'object' && !Array.isArray(alias) && !('folderId' in alias)
            ? { ...alias, folderId: null }
            : alias
        )
      : raw.aliases
  })
}

export function migrateRawConfig(value: unknown): MigrationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      raw: {},
      warnings: ['配置文件根节点必须是对象，已使用默认配置'],
      unsupported: true
    }
  }

  const raw = { ...(value as RawConfig) }
  const warnings: string[] = []
  const version = raw.version

  if (version === undefined) {
    warnings.push('配置缺少版本号，已按当前版本恢复')
    raw.version = 1
  }

  const normalizedVersion = raw.version
  if (
    typeof normalizedVersion !== 'number' ||
    !Number.isInteger(normalizedVersion) ||
    normalizedVersion < 1
  ) {
    return {
      raw: {},
      warnings: ['配置版本号非法，已使用默认配置'],
      unsupported: true
    }
  }

  if (normalizedVersion > CURRENT_CONFIG_VERSION) {
    return {
      raw: {},
      warnings: [`配置版本 ${normalizedVersion} 高于当前支持的版本 ${CURRENT_CONFIG_VERSION}`],
      unsupported: true
    }
  }

  let current = raw
  let currentVersion = normalizedVersion
  while (currentVersion < CURRENT_CONFIG_VERSION) {
    const migration = configMigrations[currentVersion]
    if (!migration) {
      return {
        raw: {},
        warnings: [`缺少从版本 ${currentVersion} 升级的迁移步骤`],
        unsupported: true
      }
    }
    current = migration(current)
    currentVersion += 1
    current.version = currentVersion
  }

  return { raw: current, warnings, unsupported: false }
}
