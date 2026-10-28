import type { Alias, AppConfig, Folder } from '@shared/config'
import type { FolderTreeNode, SettingsState } from '@shared/ipc'

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeAliases(value: unknown): Alias[] {
  return asArray<Record<string, unknown>>(value)
    .filter((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      id: asString(item.id),
      command: asString(item.command),
      value: asString(item.value),
      enabled: item.enabled !== false,
      folderId: typeof item.folderId === 'string' && item.folderId.length > 0 ? item.folderId : null
    }))
    .filter((alias) => alias.id.length > 0 && alias.command.length > 0)
}

function normalizeFolders(value: unknown): Folder[] {
  return asArray<Record<string, unknown>>(value)
    .filter((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      id: asString(item.id),
      name: asString(item.name),
      parentId: typeof item.parentId === 'string' && item.parentId.length > 0 ? item.parentId : null
    }))
    .filter((folder) => folder.id.length > 0 && folder.name.length > 0)
}

/** Rebuilds the nested read model so the renderer never depends on the main process shape. */
function normalizeFolderTree(
  value: unknown,
  folders: Folder[],
  aliases: Alias[]
): FolderTreeNode[] {
  const provided = asArray<FolderTreeNode>(value)
  if (provided.length > 0 || folders.length === 0) return provided

  const nodes = new Map<string, FolderTreeNode>()
  for (const folder of folders) nodes.set(folder.id, { ...folder, children: [], aliases: [] })
  for (const alias of aliases) {
    if (alias.folderId) nodes.get(alias.folderId)?.aliases.push(alias)
  }
  const roots: FolderTreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/**
 * Accepts a settings snapshot from any app version and returns a fully shaped
 * `SettingsState`. Returns null only when the config payload itself is unusable,
 * so callers can show a load error instead of crashing mid-render.
 */
export function normalizeSettingsState(input: unknown): SettingsState | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const rawConfig = raw.config
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return null

  const config = rawConfig as Record<string, unknown>
  const server = (config.server ?? {}) as Record<string, unknown>
  const plugins = (config.plugins ?? {}) as Record<string, unknown>
  const rawRuntime = (raw.runtime ?? {}) as Record<string, unknown>

  const folders = normalizeFolders(Array.isArray(raw.folders) ? raw.folders : config.folders)
  const aliases = normalizeAliases(config.aliases)
  const normalizedConfig: AppConfig = {
    ...(config as unknown as AppConfig),
    version: 2,
    onboardingComplete: config.onboardingComplete === true,
    hotkey: asString(config.hotkey, 'CommandOrControl+Shift+Space'),
    insertMode: config.insertMode === 'replace' ? 'replace' : 'caret',
    launchAtLogin: config.launchAtLogin === true,
    server: { token: asString(server.token) },
    plugins: { enabled: plugins.enabled !== false },
    folders,
    aliases
  }

  return {
    config: normalizedConfig,
    folders,
    folderTree: normalizeFolderTree(raw.folderTree, folders, aliases),
    plugins: asArray(raw.plugins),
    pluginDirectory: asString(raw.pluginDirectory),
    commands: asArray(raw.commands),
    conflicts: asArray(raw.conflicts),
    connections: asArray(raw.connections),
    runtime: {
      port: typeof rawRuntime.port === 'number' ? rawRuntime.port : 0,
      hotkey: asString(rawRuntime.hotkey, normalizedConfig.hotkey),
      hotkeyRegistered: rawRuntime.hotkeyRegistered === true,
      errors: asArray(rawRuntime.errors),
      configRecovered: rawRuntime.configRecovered === true,
      configStatus:
        rawRuntime.configStatus === 'created' ||
        rawRuntime.configStatus === 'partial' ||
        rawRuntime.configStatus === 'recovered'
          ? rawRuntime.configStatus
          : 'ok',
      configWarnings: asArray(rawRuntime.configWarnings),
      ...(typeof rawRuntime.configBackupPath === 'string'
        ? { configBackupPath: rawRuntime.configBackupPath }
        : {})
    }
  } as SettingsState
}
