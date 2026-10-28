import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '@shared/config'
import type { ConfigLoadResult, ConfigStore } from '../../../src/main/config/config-store'
import type { ConnectionServer } from '../../../src/main/connection/connection-server'
import { CommandRegistry } from '../../../src/main/commands/registry'
import { AppService } from '../../../src/main/services/app-service'
import type { HotkeyManager } from '../../../src/main/app/hotkey-manager'
import type { WindowManager } from '../../../src/main/app/windows'

function makeDependencies(): {
  service: AppService
  store: { save: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> }
  insert: ReturnType<typeof vi.fn>
  hideOverlay: ReturnType<typeof vi.fn>
  connection: Record<string, unknown>
  windows: Record<string, unknown>
  setLaunchAtLogin: ReturnType<typeof vi.fn>
  getLaunchAtLogin: ReturnType<typeof vi.fn>
} {
  const config = createDefaultConfig('a'.repeat(32))
  config.aliases = [{ id: 'a1', command: 'name', value: '张三', enabled: true }]
  const loadResult: ConfigLoadResult = { config, status: 'ok', warnings: [] }
  const store = {
    save: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined)
  }
  const insert = vi.fn(async () => ({ connectionId: 'c1', browserName: 'Chrome' }))
  const connection = {
    start: vi.fn(async () => 47821),
    stop: vi.fn(async () => undefined),
    insert,
    getSnapshot: () => ({ port: 47821, connections: [], lastError: null }),
    getPort: () => 47821,
    onChanged: vi.fn(() => () => undefined),
    setToken: vi.fn()
  }
  const hotkeys = {
    register: vi.fn(() => ({ ok: true, accelerator: 'CommandOrControl+Shift+Space' })),
    unregister: vi.fn(),
    isRegistered: vi.fn(() => true),
    getCurrent: vi.fn(() => 'CommandOrControl+Shift+Space')
  }
  const hideOverlay = vi.fn()
  const windows = {
    hideOverlay,
    sendOverlayResult: vi.fn()
  }
  let launchAtLogin = false
  const setLaunchAtLogin = vi.fn((enabled: boolean) => {
    launchAtLogin = enabled
  })
  const getLaunchAtLogin = vi.fn(() => launchAtLogin)
  const pluginHost = {
    load: vi.fn(async () => ({ plugins: [], infos: [] }))
  }
  const service = new AppService({
    store: store as unknown as ConfigStore,
    loadResult,
    pluginHost: pluginHost as never,
    pluginDirectory: '/tmp/plugins',
    hotkeys: hotkeys as unknown as HotkeyManager,
    connection: connection as unknown as ConnectionServer,
    windows: windows as unknown as Pick<WindowManager, 'hideOverlay' | 'sendOverlayResult'>,
    registry: new CommandRegistry(),
    setLaunchAtLogin,
    getLaunchAtLogin,
    connectionRetryDelaysMs: []
  })
  return {
    service,
    store,
    insert,
    hideOverlay,
    connection,
    windows,
    setLaunchAtLogin,
    getLaunchAtLogin
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AppService overlay flow', () => {
  it('submits a resolved command and hides the overlay after the success delay', async () => {
    const { service, insert, hideOverlay } = makeDependencies()
    await service.initialize()
    vi.useFakeTimers()

    await expect(service.submitOverlay('name')).resolves.toEqual({ ok: true })
    expect(insert).toHaveBeenCalledWith('张三', 'caret')
    expect(hideOverlay).not.toHaveBeenCalled()
    vi.advanceTimersByTime(120)
    expect(hideOverlay).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('keeps the overlay open for command and connection failures', async () => {
    const { service, insert, hideOverlay, connection } = makeDependencies()
    await service.initialize()
    vi.useFakeTimers()

    await expect(service.submitOverlay('missing')).resolves.toMatchObject({
      ok: false,
      code: 'COMMAND_NOT_FOUND'
    })
    insert.mockRejectedValueOnce(
      Object.assign(new Error('未连接'), { code: 'EXTENSION_DISCONNECTED' })
    )
    await expect(service.submitOverlay('name')).resolves.toMatchObject({
      ok: false,
      code: 'EXTENSION_DISCONNECTED'
    })
    expect(hideOverlay).not.toHaveBeenCalled()
    expect(connection.stop).toBeDefined()
    await service.dispose()
  })
})

describe('AppService settings mutations', () => {
  it('rotates the pairing token, persists it and informs the connection server', async () => {
    const { service, store, connection } = makeDependencies()
    await service.initialize()
    const before = service.getState().config.server.token

    const state = await service.rotateToken()

    expect(state.config.server.token).not.toBe(before)
    expect(state.config.server.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(store.save).toHaveBeenCalled()
    expect(connection.setToken).toHaveBeenCalledWith(state.config.server.token)
    await service.dispose()
  })

  it('creates, updates and deletes aliases with duplicate-name protection', async () => {
    const { service } = makeDependencies()
    await service.initialize()

    const created = await service.createAlias({ command: 'nick', value: '小明' })
    expect(service.getState().commands).toEqual(
      expect.arrayContaining([{ command: 'nick', source: 'alias' }])
    )

    await expect(service.createAlias({ command: 'NICK', value: '重复' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })

    const updated = await service.updateAlias({ id: created.id, value: '大明', enabled: false })
    expect(updated).toMatchObject({ value: '大明', enabled: false })
    await expect(service.submitOverlay('nick')).resolves.toMatchObject({
      ok: false,
      code: 'COMMAND_NOT_FOUND'
    })

    const state = await service.deleteAlias(created.id)
    expect(state.config.aliases.some((alias) => alias.id === created.id)).toBe(false)
    await service.dispose()
  })

  it('persists general settings and onboarding completion', async () => {
    const { service, store, setLaunchAtLogin, getLaunchAtLogin } = makeDependencies()
    await service.initialize()
    store.save.mockClear()

    const state = await service.updateGeneral({ insertMode: 'replace', launchAtLogin: true })
    expect(state.config.insertMode).toBe('replace')
    expect(state.config.launchAtLogin).toBe(true)
    expect(setLaunchAtLogin).toHaveBeenCalledWith(true)
    expect(getLaunchAtLogin).toHaveBeenCalled()
    expect(store.save).toHaveBeenCalledOnce()

    const onboarded = await service.completeOnboarding()
    expect(onboarded.config.onboardingComplete).toBe(true)
    await service.dispose()
  })
})

describe('AppService folder operations', () => {
  it('creates nested folders and rejects duplicate sibling names', async () => {
    const { service } = makeDependencies()
    await service.initialize()

    const work = await service.createFolder({ name: 'Work' })
    const drafts = await service.createFolder({ name: 'Drafts', parentId: work.id })
    expect(drafts.parentId).toBe(work.id)

    await expect(service.createFolder({ name: 'drafts', parentId: work.id })).rejects.toMatchObject(
      {
        code: 'INVALID_PAYLOAD'
      }
    )
    // The same name is fine under a different parent.
    await expect(service.createFolder({ name: 'Drafts', parentId: null })).resolves.toMatchObject({
      name: 'Drafts',
      parentId: null
    })

    await expect(
      service.createFolder({ name: 'Nowhere', parentId: 'missing' })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    await service.dispose()
  })

  it('renames folders and prevents cyclic moves', async () => {
    const { service } = makeDependencies()
    await service.initialize()

    const parent = await service.createFolder({ name: 'Parent' })
    const child = await service.createFolder({ name: 'Child', parentId: parent.id })

    await expect(service.updateFolder({ id: parent.id, name: 'Renamed' })).resolves.toMatchObject({
      id: parent.id,
      name: 'Renamed'
    })
    await expect(
      service.updateFolder({ id: parent.id, parentId: parent.id })
    ).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
    await expect(service.updateFolder({ id: parent.id, parentId: child.id })).rejects.toMatchObject(
      {
        code: 'INVALID_PAYLOAD'
      }
    )
    await service.dispose()
  })

  it('refuses to delete a non-empty folder without explicit relocation', async () => {
    const { service } = makeDependencies()
    await service.initialize()

    const folder = await service.createFolder({ name: 'Inbox' })
    const child = await service.createFolder({ name: 'Nested', parentId: folder.id })
    const alias = await service.createAlias({ command: 'nick', value: '小明', folderId: folder.id })

    await expect(service.deleteFolder(folder.id)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(service.getState().folders.some((item) => item.id === folder.id)).toBe(true)

    const state = await service.deleteFolder(folder.id, true)
    expect(state.folders.some((item) => item.id === folder.id)).toBe(false)
    expect(state.folders.find((item) => item.id === child.id)?.parentId).toBeNull()
    expect(state.config.aliases.find((item) => item.id === alias.id)?.folderId).toBeNull()
    await service.dispose()
  })

  it('keeps command lookup global across folders', async () => {
    const { service } = makeDependencies()
    await service.initialize()

    const folder = await service.createFolder({ name: 'Work' })
    await service.createAlias({ command: 'nick', value: '小明', folderId: folder.id })

    await expect(
      service.createAlias({ command: 'NICK', value: '重复', folderId: null })
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    await expect(service.submitOverlay('nick')).resolves.toEqual({ ok: true })
    await service.dispose()
  })

  it('builds a sorted folder tree snapshot with root mappings outside folders', async () => {
    const { service } = makeDependencies()
    await service.initialize()

    const work = await service.createFolder({ name: 'Work' })
    await service.createFolder({ name: 'Archive', parentId: work.id })
    await service.createFolder({ name: 'Home' })
    await service.createAlias({ command: 'nick', value: '小明', folderId: work.id })

    const tree = service.getState().folderTree
    expect(tree.map((node) => node.name)).toEqual(['Home', 'Work'])
    expect(tree[1]?.children.map((node) => node.name)).toEqual(['Archive'])
    expect(tree[1]?.aliases.map((alias) => alias.command)).toEqual(['nick'])
    expect(tree[0]?.aliases).toEqual([])
    await service.dispose()
  })
})
