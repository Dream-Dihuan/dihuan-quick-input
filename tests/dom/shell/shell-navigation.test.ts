import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createDefaultConfig } from '@shared/config'
import type { SettingsState } from '@shared/ipc'
import ShellApp from '../../../src/renderer/src/shell/ShellApp.vue'
import { VIEW_STORAGE_KEY } from '../../../src/renderer/src/shell/navigation'

type StateHandler = (state: SettingsState) => void
type ShellViewHandler = (request: { view: 'mappings' | 'settings' }) => void

let stateHandler: StateHandler | undefined
let shellViewHandler: ShellViewHandler | undefined
let appErrorHandler:
  ((error: { code: string; message: string; details?: string }) => void) | undefined
let getState: ReturnType<typeof vi.fn>
let wrapper: VueWrapper | undefined

function makeState(onboardingComplete = true): SettingsState {
  const config = createDefaultConfig('a'.repeat(32))
  config.onboardingComplete = onboardingComplete
  config.aliases = [{ id: 'a1', command: 'name', value: '张三', enabled: true, folderId: null }]
  return {
    config,
    folders: [],
    folderTree: [],
    plugins: [],
    pluginDirectory: '/tmp/plugins',
    commands: [],
    conflicts: [],
    connections: [],
    runtime: {
      port: 47821,
      hotkey: config.hotkey,
      hotkeyRegistered: true,
      errors: [],
      configRecovered: false,
      configStatus: 'ok',
      configWarnings: []
    }
  }
}

function installApi(state: SettingsState): void {
  getState = vi.fn(async () => ({ ok: true as const, data: state }))
  const api = {
    settings: {
      getState,
      updateGeneral: vi.fn(async () => ({ ok: true as const, data: state })),
      aliases: {
        create: vi.fn(async () => ({ ok: true as const, data: { id: 'a9' } })),
        update: vi.fn(async () => ({ ok: true as const, data: {} })),
        remove: vi.fn(async () => ({ ok: true as const, data: state }))
      },
      folders: {
        create: vi.fn(async () => ({ ok: true as const, data: {} })),
        update: vi.fn(async () => ({ ok: true as const, data: {} })),
        remove: vi.fn(async () => ({ ok: true as const, data: state }))
      },
      plugins: {
        list: vi.fn(async () => ({ ok: true as const, data: [] })),
        reload: vi.fn(async () => ({ ok: true as const, data: state })),
        openDirectory: vi.fn(async () => ({ ok: true as const, data: { path: '/tmp' } }))
      },
      connection: {
        getStatus: vi.fn(async () => ({ ok: true as const, data: state })),
        rotateToken: vi.fn(async () => ({ ok: true as const, data: state }))
      },
      onboarding: {
        complete: vi.fn(async () => ({ ok: true as const, data: state }))
      }
    },
    events: {
      onSettingsState: (callback: StateHandler) => {
        stateHandler = callback
        return () => undefined
      },
      onAppError: (
        callback: (error: { code: string; message: string; details?: string }) => void
      ) => {
        appErrorHandler = callback
        return () => undefined
      },
      onShellView: (callback: ShellViewHandler) => {
        shellViewHandler = callback
        return () => undefined
      }
    }
  }
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
}

async function mountShell(state = makeState()): Promise<VueWrapper> {
  installApi(state)
  wrapper = mount(ShellApp, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

function pageIds(root: ParentNode = document): string[] {
  return [...root.querySelectorAll<HTMLElement>('section.page')].map((page) => page.id)
}

function activePageIds(root: ParentNode = document): string[] {
  return [...root.querySelectorAll<HTMLElement>('section.page.page--active')].map((page) => page.id)
}

function navButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.sidebar-item')].find((item) =>
    item.textContent?.includes(label)
  )
  if (!button) throw new Error(`没有找到导航项：${label}`)
  return button
}

beforeEach(() => {
  window.localStorage.clear()
  stateHandler = undefined
  shellViewHandler = undefined
  appErrorHandler = undefined
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'api')
  window.localStorage.clear()
})

describe('ShellApp navigation', () => {
  it('mounts both pages and keeps exactly one visible', async () => {
    await mountShell()
    expect(pageIds()).toEqual(['view-mappings', 'view-settings'])
    expect(activePageIds()).toEqual(['view-mappings'])
  })

  it('lands on the settings page during onboarding', async () => {
    await mountShell(makeState(false))
    expect(activePageIds()).toEqual(['view-settings'])
  })

  it('restores the last viewed page', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'settings')
    await mountShell()
    expect(activePageIds()).toEqual(['view-settings'])
  })

  it('switches pages from the sidebar and tracks aria-current', async () => {
    await mountShell()
    expect(navButton('映射与脚本').getAttribute('aria-current')).toBe('page')
    expect(navButton('设置').getAttribute('aria-current')).toBeNull()

    navButton('设置').click()
    await flushPromises()

    expect(activePageIds()).toEqual(['view-settings'])
    expect(navButton('设置').getAttribute('aria-current')).toBe('page')
    expect(navButton('映射与脚本').getAttribute('aria-current')).toBeNull()
    expect(document.querySelector('.page-stack')?.getAttribute('data-direction')).toBe('forward')
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBe('settings')

    navButton('映射与脚本').click()
    await flushPromises()
    expect(document.querySelector('.page-stack')?.getAttribute('data-direction')).toBe('back')
  })

  it('hides the inactive page from focus and assistive tech', async () => {
    await mountShell()
    const settings = document.getElementById('view-settings')
    expect(settings?.getAttribute('aria-hidden')).toBe('true')
    expect(settings?.hasAttribute('inert')).toBe(true)

    navButton('设置').click()
    await flushPromises()
    expect(document.getElementById('view-mappings')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.getElementById('view-settings')?.getAttribute('aria-hidden')).toBe('false')
  })

  it('switches pages with CommandOrControl+1/2 but not while typing', async () => {
    await mountShell()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', metaKey: true }))
    await flushPromises()
    expect(activePageIds()).toEqual(['view-settings'])

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }))
    await flushPromises()
    expect(activePageIds()).toEqual(['view-mappings'])

    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', metaKey: true, bubbles: true }))
    await flushPromises()
    expect(activePageIds()).toEqual(['view-mappings'])
  })

  it('keeps an open mapping dialog alive across a page switch', async () => {
    await mountShell()
    const create = document.querySelector<HTMLButtonElement>('.heading-actions .button.primary')
    if (!create) throw new Error('没有找到新增映射按钮')
    create.click()
    await flushPromises()

    const command = document.querySelector<HTMLInputElement>('#alias-command')
    if (!command) throw new Error('映射对话框没有打开')
    command.value = 'nickname'
    command.dispatchEvent(new Event('input'))
    await flushPromises()

    navButton('设置').click()
    await flushPromises()
    navButton('映射与脚本').click()
    await flushPromises()

    const dialog = document.querySelector<HTMLDialogElement>('.alias-dialog')
    expect(dialog?.open).toBe(true)
    expect(document.querySelector<HTMLInputElement>('#alias-command')?.value).toBe('nickname')
  })

  it('opens the settings page when the main process asks for it', async () => {
    await mountShell()
    expect(shellViewHandler).toBeTypeOf('function')

    shellViewHandler?.({ view: 'settings' })
    await flushPromises()
    expect(activePageIds()).toEqual(['view-settings'])
  })

  it('refreshes state pushed by the main process', async () => {
    await mountShell()
    const next = makeState()
    next.config.aliases = [
      ...next.config.aliases,
      { id: 'a2', command: 'mail', value: 'me@example.com', enabled: true, folderId: null }
    ]
    stateHandler?.(next)
    await flushPromises()
    expect(document.querySelector('.sidebar-count')?.textContent?.trim()).toBe('2')
  })

  it('keeps a single page active through rapid switching', async () => {
    await mountShell()
    for (let index = 0; index < 6; index += 1) {
      navButton(index % 2 === 0 ? '设置' : '映射与脚本').click()
    }
    await flushPromises()
    expect(activePageIds()).toHaveLength(1)
    expect(document.querySelectorAll('.page').length).toBe(2)
  })

  it('shows one replaceable toast that clears after five seconds', async () => {
    await mountShell()
    expect(document.querySelector('.toast')).toBeNull()

    vi.useFakeTimers()
    try {
      appErrorHandler?.({ code: 'SERVER_ERROR', message: '端口被占用', details: 'EADDRINUSE' })
      await flushPromises()
      expect(document.querySelectorAll('.toast')).toHaveLength(1)
      expect(document.querySelector('.toast')?.textContent).toContain('EADDRINUSE')

      appErrorHandler?.({ code: 'PLUGIN_ERROR', message: '插件加载失败' })
      await flushPromises()
      expect(document.querySelectorAll('.toast')).toHaveLength(1)
      expect(document.querySelector('.toast')?.textContent).toContain('插件加载失败')

      vi.advanceTimersByTime(5_000)
      await flushPromises()
      expect(document.querySelector('.toast')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
