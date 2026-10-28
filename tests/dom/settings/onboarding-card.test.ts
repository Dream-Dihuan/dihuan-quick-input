import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createDefaultConfig } from '@shared/config'
import type { SettingsState } from '@shared/ipc'
import OnboardingCard from '../../../src/renderer/src/settings/OnboardingCard.vue'
import SettingsView from '../../../src/renderer/src/views/SettingsView.vue'

let wrapper: VueWrapper | undefined

function makeState(onboardingComplete: boolean): SettingsState {
  const config = createDefaultConfig('a'.repeat(32))
  config.onboardingComplete = onboardingComplete
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
  } as SettingsState
}

function stubPlugins(): void {
  Object.defineProperty(window, 'api', {
    value: {
      settings: {
        onboarding: { complete: vi.fn(async () => ({ ok: true, data: makeState(true) })) },
        plugins: { openDirectory: vi.fn(async () => ({ ok: true, data: { path: '/tmp' } })) }
      }
    },
    configurable: true,
    writable: true
  })
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'api')
})

describe('OnboardingCard', () => {
  it('sends the user to the scripts section from step 3', async () => {
    stubPlugins()
    wrapper = mount(OnboardingCard, { props: { state: makeState(false) }, attachTo: document.body })

    const go = [...document.querySelectorAll<HTMLButtonElement>('.button')].find((button) =>
      button.textContent?.includes('前往映射与脚本')
    )
    expect(go).toBeDefined()
    go?.click()
    await flushPromises()

    expect(wrapper.emitted('navigate')?.[0]).toEqual(['mappings', 'plugins'])
  })

  it('completes onboarding through the main process', async () => {
    stubPlugins()
    wrapper = mount(OnboardingCard, { props: { state: makeState(false) }, attachTo: document.body })

    const complete = [...document.querySelectorAll<HTMLButtonElement>('.button')].find((button) =>
      button.textContent?.includes('完成引导')
    )
    complete?.click()
    await flushPromises()

    expect(window.api.settings.onboarding.complete).toHaveBeenCalled()
    expect(wrapper.emitted('feedback')?.[0]?.[1]).toBe('success')
  })
})

describe('SettingsView onboarding placement', () => {
  it('shows the guide at the top of the settings page until it is complete', () => {
    wrapper = mount(SettingsView, {
      props: { state: makeState(false), active: true },
      attachTo: document.body
    })
    expect(wrapper.find('.onboarding').exists()).toBe(true)

    wrapper.unmount()
    wrapper = mount(SettingsView, {
      props: { state: makeState(true), active: true },
      attachTo: document.body
    })
    expect(wrapper.find('.onboarding').exists()).toBe(false)
  })

  it('groups only hotkeys and browser-extension content on the settings page', () => {
    wrapper = mount(SettingsView, {
      props: { state: makeState(true), active: true },
      attachTo: document.body
    })
    const ids = [...document.querySelectorAll<HTMLElement>('section.card')].map(
      (section) => section.id
    )
    expect(ids).toEqual(['general', 'connection'])
    expect(document.querySelector('#aliases')).toBeNull()
    expect(document.querySelector('#plugins')).toBeNull()
  })
})
