import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import AppTitlebar from '../../../src/renderer/src/shell/AppTitlebar.vue'

let wrapper: VueWrapper | undefined

function mountTitlebar(): VueWrapper {
  wrapper = mount(AppTitlebar, {
    props: { view: 'mappings', browserConnected: false },
    attachTo: document.body
  })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  delete document.documentElement.dataset.platform
  document.body.innerHTML = ''
})

describe('AppTitlebar', () => {
  it('renders a drag-capable titlebar with the current page label', () => {
    delete document.documentElement.dataset.platform
    const titlebar = mountTitlebar().get('.app-titlebar')
    expect(titlebar.text()).toContain('映射与脚本')
    expect(titlebar.classes()).toContain('app-titlebar')
  })

  it('adds the platform classes that keep native window controls clear', async () => {
    document.documentElement.dataset.platform = 'darwin'
    const mac = mountTitlebar().get('.app-titlebar')
    expect(mac.classes()).toContain('titlebar--darwin')
    expect(mac.attributes('data-platform')).toBe('darwin')

    document.documentElement.dataset.platform = 'win32'
    await wrapper?.setProps({ view: 'settings' })
    const win = mountTitlebar().get('.app-titlebar')
    expect(win.classes()).toContain('titlebar--win32')

    document.documentElement.dataset.platform = 'linux'
    const linux = mountTitlebar().get('.app-titlebar')
    expect(linux.classes()).toContain('titlebar--linux')
  })

  it('shows connection state in the header status pills', async () => {
    document.documentElement.dataset.platform = 'darwin'
    const mounted = mountTitlebar()
    expect(mounted.text()).toContain('等待浏览器连接')

    await mounted.setProps({ browserConnected: true, browserLabel: 'Chrome' })
    expect(mounted.text()).toContain('浏览器已连接')
    expect(mounted.find('[title="Chrome"]').exists()).toBe(true)
  })
})
