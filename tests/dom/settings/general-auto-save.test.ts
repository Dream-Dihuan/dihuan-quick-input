import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createDefaultConfig, type AppConfig } from '@shared/config'
import type { IpcResult, SettingsState } from '@shared/ipc'
import GeneralSection from '../../../src/renderer/src/settings/GeneralSection.vue'

let state: SettingsState
let updateGeneral: ReturnType<typeof vi.fn>
let wrapper: VueWrapper | undefined

function makeState(overrides: Partial<AppConfig> = {}): SettingsState {
  const config = createDefaultConfig('a'.repeat(32))
  Object.assign(config, overrides)
  return {
    config,
    folders: [],
    folderTree: [],
    plugins: [],
    pluginDirectory: '',
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
  } as SettingsState
}

function installApi(): void {
  updateGeneral = vi.fn(async () => ({ ok: true as const, data: state }))
  Object.defineProperty(window, 'api', {
    value: { settings: { updateGeneral } },
    configurable: true,
    writable: true
  })
}

function mountSection(active = true): VueWrapper {
  wrapper = mount(GeneralSection, { props: { state, active }, attachTo: document.body })
  return wrapper
}

function recordHotkey(key = 'K'): void {
  const record = [...document.querySelectorAll<HTMLButtonElement>('.hotkey-row .button')].find(
    (button) => button.textContent?.includes('录制快捷键')
  )
  record?.click()
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true }))
}

function applyButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('.hotkey-row .button.primary')
  if (!button) throw new Error('没有找到应用快捷键按钮')
  return button
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'api')
})

describe('hotkey apply', () => {
  it('keeps the apply button disabled until a new binding is recorded', async () => {
    state = makeState()
    installApi()
    mountSection()
    expect(applyButton().disabled).toBe(true)

    recordHotkey()
    await flushPromises()
    expect(applyButton().disabled).toBe(false)

    applyButton().click()
    await flushPromises()
    expect(updateGeneral).toHaveBeenCalledWith({ hotkey: 'CommandOrControl+K' })
    expect(wrapper?.emitted('feedback')?.[0]).toEqual(['快捷键已生效', 'success'])
  })

  it('ignores recorded keys while the page is hidden', async () => {
    state = makeState()
    installApi()
    mountSection(false)
    recordHotkey()
    await flushPromises()
    expect(applyButton().disabled).toBe(true)
  })
})

describe('immediate saves', () => {
  it('saves the insert mode as soon as it changes', async () => {
    state = makeState()
    installApi()
    mountSection()

    await wrapper?.find('#insert-mode').setValue('replace')
    await flushPromises()

    expect(updateGeneral).toHaveBeenCalledTimes(1)
    expect(updateGeneral).toHaveBeenCalledWith({ insertMode: 'replace' })
    expect(wrapper?.emitted('updated')).toHaveLength(1)
  })

  it('saves the launch-at-login switch as soon as it changes', async () => {
    state = makeState()
    installApi()
    mountSection()

    await wrapper?.find('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(updateGeneral).toHaveBeenCalledWith({ launchAtLogin: true })
  })

  it('rolls back to the saved value when the write fails', async () => {
    state = makeState()
    installApi()
    updateGeneral.mockResolvedValueOnce({
      ok: false,
      error: { code: 'CONFIG_ERROR', message: '写入失败' }
    } satisfies IpcResult<SettingsState>)
    mountSection()

    await wrapper?.find('#insert-mode').setValue('replace')
    await flushPromises()

    const select = document.querySelector<HTMLSelectElement>('#insert-mode')
    expect(select?.value).toBe('caret')
    expect(wrapper?.emitted('feedback')?.[0]).toEqual(['写入失败', 'error'])
  })

  it('serialises rapid changes so responses cannot land out of order', async () => {
    state = makeState()
    installApi()
    let resolveFirst: (value: IpcResult<SettingsState>) => void = () => undefined
    updateGeneral.mockImplementationOnce(
      () =>
        new Promise<IpcResult<SettingsState>>((resolve) => {
          resolveFirst = resolve
        })
    )
    mountSection()

    await wrapper?.find('#insert-mode').setValue('replace')
    await flushPromises()
    expect(updateGeneral).toHaveBeenCalledTimes(1)

    await wrapper?.find('#insert-mode').setValue('caret')
    await flushPromises()
    expect(updateGeneral).toHaveBeenCalledTimes(1)

    resolveFirst({ ok: true, data: state })
    await flushPromises()
    expect(updateGeneral).toHaveBeenCalledTimes(2)
    expect(updateGeneral).toHaveBeenLastCalledWith({ insertMode: 'caret' })
  })
})
