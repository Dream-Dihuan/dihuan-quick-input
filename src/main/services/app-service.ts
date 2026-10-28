import { randomUUID } from 'node:crypto'
import type { Alias, AppConfig, Folder, InsertMode } from '@shared/config'
import { appError, type AppErrorInfo } from '@shared/errors'
import type {
  AliasCreateInput,
  AliasUpdateInput,
  FolderCreateInput,
  FolderUpdateInput,
  FolderTreeNode,
  OverlayResult,
  PluginInfo,
  SettingsState,
  UpdateGeneralInput
} from '@shared/ipc'
import type { HotkeyManager } from '../app/hotkey-manager'
import type { WindowManager } from '../app/windows'
import type { CommandRegistry } from '../commands/registry'
import type { PluginHost } from '../commands/plugin-host'
import { CommandResolver } from '../commands/resolver'
import type { LoadedPlugin } from '../commands/types'
import type { ConfigLoadResult, ConfigStore } from '../config/config-store'
import { generatePairingToken } from '../config/token'
import type {
  ConnectionServer,
  ConnectionSnapshot,
  InsertSuccess
} from '../connection/connection-server'
import { AppErrorException } from './errors'
import { OverlaySubmitService } from './overlay-submit'

type WindowPort = Pick<WindowManager, 'hideOverlay' | 'sendOverlayResult'>

export interface AppServiceDependencies {
  store: ConfigStore
  loadResult: ConfigLoadResult
  pluginHost: PluginHost
  pluginDirectory: string
  hotkeys: HotkeyManager
  connection: ConnectionServer
  windows: WindowPort
  registry: CommandRegistry
  setLaunchAtLogin: (enabled: boolean) => void
  getLaunchAtLogin: () => boolean
  onStateChanged?: (state: SettingsState) => void
  connectionRetryDelaysMs?: number[]
}

export class AppService {
  private config: AppConfig
  private loadResult: ConfigLoadResult
  private readonly registry: CommandRegistry
  private readonly resolver: CommandResolver
  private readonly overlaySubmit: OverlaySubmitService
  private loadedPlugins: LoadedPlugin[] = []
  private pluginInfos: PluginInfo[] = []
  private readonly runtimeErrors = new Map<string, AppErrorInfo>()
  private connectionRetryTimer: NodeJS.Timeout | null = null
  private connectionRetryAttempt = 0
  private disposed = false

  constructor(private readonly dependencies: AppServiceDependencies) {
    this.config = dependencies.loadResult.config
    this.loadResult = dependencies.loadResult
    this.registry = dependencies.registry
    this.resolver = new CommandResolver(this.registry)
    this.overlaySubmit = new OverlaySubmitService({
      resolver: this.resolver,
      getInsertMode: () => this.config.insertMode,
      insert: (text, mode) => this.insertText(text, mode),
      onSuccess: () => {
        setTimeout(() => {
          if (!this.disposed) this.dependencies.windows.hideOverlay()
        }, 120)
      }
    })
  }

  async initialize(): Promise<void> {
    await this.reloadPlugins(false)

    const hotkey = this.dependencies.hotkeys.register(this.config.hotkey)
    if (!hotkey.ok && hotkey.error) {
      this.runtimeErrors.set('hotkey', hotkey.error)
    } else {
      this.runtimeErrors.delete('hotkey')
    }

    this.dependencies.connection.onChanged(() => this.broadcast())

    await this.startConnection()
    this.broadcast()
  }

  getState(): SettingsState {
    const snapshot = this.dependencies.connection.getSnapshot()
    return {
      config: structuredClone(this.config),
      folders: this.config.folders.map((folder) => ({ ...folder })),
      folderTree: this.buildFolderTree(),
      plugins: this.pluginInfos.map((plugin) => ({
        ...plugin,
        commands: [...plugin.commands]
      })),
      pluginDirectory: this.dependencies.pluginDirectory,
      commands: this.registry.list(),
      conflicts: this.registry.getConflicts(),
      connections: snapshot.connections.map((connection) => ({ ...connection })),
      runtime: {
        port: snapshot.port ?? this.dependencies.connection.getPort(),
        hotkey: this.config.hotkey,
        hotkeyRegistered: this.dependencies.hotkeys.isRegistered(),
        errors: this.mergedErrors(snapshot),
        configRecovered:
          this.loadResult.status === 'recovered' || this.loadResult.status === 'partial',
        configStatus: this.loadResult.status,
        configWarnings: [...this.loadResult.warnings],
        ...(this.loadResult.backupPath ? { configBackupPath: this.loadResult.backupPath } : {})
      }
    }
  }

  async updateGeneral(input: UpdateGeneralInput): Promise<SettingsState> {
    const previous = this.config
    let next: AppConfig = { ...previous }
    let hotkeyChanged = false
    let loginChanged = false

    if (input.hotkey !== undefined) {
      const hotkey = this.dependencies.hotkeys.register(input.hotkey)
      if (!hotkey.ok || !hotkey.accelerator) {
        const error = hotkey.error ?? appError('HOTKEY_INVALID', '快捷键格式无效')
        this.runtimeErrors.set('hotkey', error)
        this.broadcast()
        throw new AppErrorException(error.code, error.message, error.details)
      }
      hotkeyChanged = previous.hotkey !== hotkey.accelerator
      next = { ...next, hotkey: hotkey.accelerator }
    }

    if (input.insertMode !== undefined) {
      next = { ...next, insertMode: input.insertMode }
    }

    if (input.launchAtLogin !== undefined && input.launchAtLogin !== previous.launchAtLogin) {
      try {
        this.dependencies.setLaunchAtLogin(input.launchAtLogin)
        loginChanged = true
        if (this.dependencies.getLaunchAtLogin() !== input.launchAtLogin) {
          throw new Error('系统未接受登录启动设置')
        }
      } catch (error) {
        if (hotkeyChanged) this.rollbackHotkey(previous.hotkey)
        if (loginChanged) {
          try {
            this.dependencies.setLaunchAtLogin(previous.launchAtLogin)
          } catch {
            // Best-effort rollback; report the original failure.
          }
        }
        throw new AppErrorException(
          'CONFIG_ERROR',
          '登录启动设置失败',
          error instanceof Error ? error.message : String(error)
        )
      }
      next = { ...next, launchAtLogin: input.launchAtLogin }
    }

    try {
      await this.dependencies.store.save(next)
    } catch (error) {
      if (hotkeyChanged) this.rollbackHotkey(previous.hotkey)
      if (loginChanged) {
        try {
          this.dependencies.setLaunchAtLogin(previous.launchAtLogin)
        } catch {
          // Best-effort rollback; the original save error is more useful.
        }
      }
      throw new AppErrorException(
        'CONFIG_ERROR',
        '保存配置失败',
        error instanceof Error ? error.message : String(error)
      )
    }

    this.config = next
    if (input.hotkey !== undefined) this.runtimeErrors.delete('hotkey')
    this.broadcast()
    return this.getState()
  }

  private buildFolderTree(): FolderTreeNode[] {
    const nodes = new Map<string, FolderTreeNode>()
    for (const folder of this.config.folders)
      nodes.set(folder.id, { ...folder, children: [], aliases: [] })
    for (const alias of this.config.aliases)
      if (alias.folderId) nodes.get(alias.folderId)?.aliases.push({ ...alias })
    const roots: FolderTreeNode[] = []
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    const sort = (items: FolderTreeNode[]): void => {
      items.sort((left, right) => left.name.localeCompare(right.name))
      for (const item of items) {
        item.aliases.sort((left, right) => left.command.localeCompare(right.command))
        sort(item.children)
      }
    }
    sort(roots)
    return roots
  }

  async createFolder(input: FolderCreateInput): Promise<Folder> {
    this.assertFolderParent(input.parentId ?? null)
    this.assertFolderNameAvailable(input.name, input.parentId ?? null)
    const folder: Folder = { id: randomUUID(), name: input.name, parentId: input.parentId ?? null }
    const next = { ...this.config, folders: [...this.config.folders, folder] }
    await this.saveConfig(next)
    this.config = next
    this.broadcast()
    return { ...folder }
  }

  async updateFolder(input: FolderUpdateInput): Promise<Folder> {
    const existing = this.config.folders.find((folder) => folder.id === input.id)
    if (!existing) throw new AppErrorException('INVALID_PAYLOAD', '文件夹不存在')
    const parentId = input.parentId === undefined ? existing.parentId : input.parentId
    this.assertFolderParent(parentId, existing.id)
    const name = input.name ?? existing.name
    this.assertFolderNameAvailable(name, parentId, existing.id)
    const updated = { ...existing, name, parentId }
    const next = {
      ...this.config,
      folders: this.config.folders.map((folder) => (folder.id === existing.id ? updated : folder))
    }
    await this.saveConfig(next)
    this.config = next
    this.broadcast()
    return { ...updated }
  }

  async deleteFolder(id: string, moveContents = false): Promise<SettingsState> {
    const folder = this.config.folders.find((candidate) => candidate.id === id)
    if (!folder) throw new AppErrorException('INVALID_PAYLOAD', '文件夹不存在')
    const hasChildren = this.config.folders.some((candidate) => candidate.parentId === id)
    const hasAliases = this.config.aliases.some((alias) => alias.folderId === id)
    if ((hasChildren || hasAliases) && !moveContents) {
      throw new AppErrorException('INVALID_PAYLOAD', '文件夹不为空，请确认移动内容后再删除')
    }
    const next = {
      ...this.config,
      folders: this.config.folders
        .filter((candidate) => candidate.id !== id)
        .map((candidate) =>
          candidate.parentId === id ? { ...candidate, parentId: folder.parentId } : candidate
        ),
      aliases: this.config.aliases.map((alias) =>
        alias.folderId === id ? { ...alias, folderId: folder.parentId } : alias
      )
    }
    await this.saveConfig(next)
    this.config = next
    this.broadcast()
    return this.getState()
  }

  private assertFolderParent(parentId: string | null, excludedId?: string): void {
    if (
      parentId &&
      (!this.config.folders.some((folder) => folder.id === parentId) || parentId === excludedId)
    ) {
      throw new AppErrorException('INVALID_PAYLOAD', '文件夹父节点无效')
    }
    if (!parentId || !excludedId) return
    let current = parentId
    while (current) {
      if (current === excludedId)
        throw new AppErrorException('INVALID_PAYLOAD', '文件夹不能移动到自身或子孙节点')
      current = this.config.folders.find((folder) => folder.id === current)?.parentId ?? ''
    }
  }

  private assertFolderNameAvailable(
    name: string,
    parentId: string | null,
    excludeId?: string
  ): void {
    const normalized = name.toLowerCase()
    if (
      this.config.folders.some(
        (folder) =>
          folder.id !== excludeId &&
          folder.parentId === parentId &&
          folder.name.toLowerCase() === normalized
      )
    ) {
      throw new AppErrorException('INVALID_PAYLOAD', '同级文件夹名称已存在')
    }
  }
  async createAlias(input: AliasCreateInput): Promise<Alias> {
    this.assertAliasNameAvailable(input.command)
    if (input.folderId && !this.config.folders.some((folder) => folder.id === input.folderId)) {
      throw new AppErrorException('INVALID_PAYLOAD', '文件夹不存在')
    }
    const alias: Alias = {
      id: randomUUID(),
      command: input.command,
      value: input.value,
      enabled: input.enabled ?? true,
      folderId: input.folderId ?? null
    }
    const next: AppConfig = { ...this.config, aliases: [...this.config.aliases, alias] }
    await this.saveConfig(next)
    this.config = next
    this.refreshRegistry()
    this.broadcast()
    return { ...alias }
  }

  async updateAlias(input: AliasUpdateInput): Promise<Alias> {
    const existing = this.config.aliases.find((alias) => alias.id === input.id)
    if (!existing) {
      throw new AppErrorException('INVALID_PAYLOAD', '命令映射不存在')
    }
    const command = input.command ?? existing.command
    this.assertAliasNameAvailable(command, input.id)

    if (
      input.folderId !== undefined &&
      input.folderId !== null &&
      !this.config.folders.some((folder) => folder.id === input.folderId)
    ) {
      throw new AppErrorException('INVALID_PAYLOAD', '文件夹不存在')
    }
    const updated: Alias = {
      ...existing,
      command,
      value: input.value ?? existing.value,
      enabled: input.enabled ?? existing.enabled,
      folderId: input.folderId === undefined ? existing.folderId : input.folderId
    }
    const next: AppConfig = {
      ...this.config,
      aliases: this.config.aliases.map((alias) => (alias.id === updated.id ? updated : alias))
    }
    await this.saveConfig(next)
    this.config = next
    this.refreshRegistry()
    this.broadcast()
    return { ...updated }
  }

  async deleteAlias(id: string): Promise<SettingsState> {
    if (!this.config.aliases.some((alias) => alias.id === id)) {
      throw new AppErrorException('INVALID_PAYLOAD', '命令映射不存在')
    }
    const next: AppConfig = {
      ...this.config,
      aliases: this.config.aliases.filter((alias) => alias.id !== id)
    }
    await this.saveConfig(next)
    this.config = next
    this.refreshRegistry()
    this.broadcast()
    return this.getState()
  }

  async reloadPlugins(broadcast = true): Promise<SettingsState> {
    if (!this.config.plugins.enabled) {
      this.loadedPlugins = []
      this.pluginInfos = []
      this.refreshRegistry()
      if (broadcast) this.broadcast()
      return this.getState()
    }

    try {
      const bundle = await this.dependencies.pluginHost.load()
      this.loadedPlugins = bundle.plugins
      this.pluginInfos = bundle.infos
      this.runtimeErrors.delete('plugins')
    } catch (error) {
      this.loadedPlugins = []
      this.pluginInfos = []
      this.runtimeErrors.set(
        'plugins',
        appError(
          'PLUGIN_ERROR',
          '插件目录加载失败',
          error instanceof Error ? error.message : String(error)
        )
      )
    }
    this.refreshRegistry()
    if (broadcast) this.broadcast()
    return this.getState()
  }

  async rotateToken(): Promise<SettingsState> {
    const token = generatePairingToken()
    const next: AppConfig = { ...this.config, server: { token } }
    await this.saveConfig(next)
    this.config = next
    this.dependencies.connection.setToken(token)
    this.broadcast()
    return this.getState()
  }

  async completeOnboarding(): Promise<SettingsState> {
    if (this.config.onboardingComplete) return this.getState()
    const next: AppConfig = { ...this.config, onboardingComplete: true }
    await this.saveConfig(next)
    this.config = next
    this.broadcast()
    return this.getState()
  }

  async submitOverlay(text: string): Promise<OverlayResult> {
    return this.overlaySubmit.submit(text)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.connectionRetryTimer) {
      clearTimeout(this.connectionRetryTimer)
      this.connectionRetryTimer = null
    }
    this.dependencies.hotkeys.unregister()
    await this.dependencies.connection.stop()
    await this.dependencies.store.flush()
  }

  private async insertText(text: string, mode: InsertMode): Promise<InsertSuccess> {
    return this.dependencies.connection.insert(text, mode)
  }

  private refreshRegistry(): void {
    this.registry.update(this.config.aliases, this.loadedPlugins)
  }

  private async saveConfig(config: AppConfig): Promise<void> {
    try {
      await this.dependencies.store.save(config)
    } catch (error) {
      throw new AppErrorException(
        'CONFIG_ERROR',
        '保存配置失败',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private assertAliasNameAvailable(command: string, excludeId?: string): void {
    const normalized = command.toLowerCase()
    const duplicate = this.config.aliases.some(
      (alias) => alias.id !== excludeId && alias.command.toLowerCase() === normalized
    )
    if (duplicate) {
      throw new AppErrorException('INVALID_PAYLOAD', '命令名已存在（不区分大小写）')
    }
  }

  private rollbackHotkey(previous: string): void {
    const result = this.dependencies.hotkeys.register(previous)
    if (!result.ok && result.error) {
      this.runtimeErrors.set('hotkey', result.error)
    }
  }

  private async startConnection(): Promise<void> {
    if (this.disposed) return
    try {
      await this.dependencies.connection.start()
      this.runtimeErrors.delete('connection')
      this.connectionRetryAttempt = 0
    } catch (error) {
      this.runtimeErrors.set(
        'connection',
        appError(
          'SERVER_ERROR',
          '本地连接服务启动失败',
          error instanceof Error ? error.message : String(error)
        )
      )
      this.scheduleConnectionRetry()
    }
  }

  private scheduleConnectionRetry(): void {
    const delays = this.dependencies.connectionRetryDelaysMs ?? [5_000, 10_000, 30_000, 60_000]
    if (delays.length === 0 || this.disposed) return
    const delay = delays[Math.min(this.connectionRetryAttempt, delays.length - 1)] ?? 60_000
    this.connectionRetryAttempt += 1
    this.connectionRetryTimer = setTimeout(() => {
      this.connectionRetryTimer = null
      void this.startConnection().finally(() => this.broadcast())
    }, delay)
  }

  private mergedErrors(snapshot: ConnectionSnapshot): AppErrorInfo[] {
    const errors = [...this.runtimeErrors.values()].map((error) => ({ ...error }))
    if (snapshot.lastError) {
      const duplicate = errors.some(
        (error) =>
          error.code === snapshot.lastError?.code && error.message === snapshot.lastError.message
      )
      if (!duplicate) errors.push({ ...snapshot.lastError })
    }
    return errors
  }

  private broadcast(): void {
    if (this.disposed) return
    try {
      this.dependencies.onStateChanged?.(this.getState())
    } catch {
      // The UI is optional; a renderer failure must not stop the service.
    }
  }
}
