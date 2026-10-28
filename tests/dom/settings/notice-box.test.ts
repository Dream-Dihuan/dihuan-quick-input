import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createDefaultConfig } from '@shared/config'
import type { SettingsState } from '@shared/ipc'
import NoticeBox from '../../../src/renderer/src/components/NoticeBox.vue'
import ConnectionSection from '../../../src/renderer/src/settings/ConnectionSection.vue'
import PluginSection from '../../../src/renderer/src/settings/PluginSection.vue'

let wrapper: VueWrapper | undefined

function makeState(overrides: Partial<SettingsState> = {}): SettingsState {
  const config = createDefaultConfig('a'.repeat(32))
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
    },
    ...overrides
  } as SettingsState
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('NoticeBox', () => {
  it('shows a summary line with the item count and stays collapsed', () => {
    wrapper = mount(NoticeBox, {
      props: { title: '命令冲突', items: ['a 同时存在于 alias / plugin', 'b 同时存在于 alias'] },
      attachTo: document.body
    })
    expect(wrapper.get('summary').text()).toContain('命令冲突')
    expect(wrapper.get('.notice-count').text()).toBe('2 条')
    expect(wrapper.get('details').element.open).toBe(false)
    expect(wrapper.findAll('.notice-body p')).toHaveLength(2)
  })

  it('expands by default for blocking errors', () => {
    wrapper = mount(NoticeBox, {
      props: { title: '此区域渲染失败', tone: 'danger', defaultOpen: true },
      attachTo: document.body
    })
    expect(wrapper.get('details').attributes()).toHaveProperty('open')
    expect(wrapper.get('details').classes()).toContain('notice--danger')
  })

  it('renders slot content inside the expandable body', () => {
    wrapper = mount(NoticeBox, {
      props: { title: '配置恢复' },
      slots: { default: '<p class="extra">备份路径 /tmp/backup.json</p>' },
      attachTo: document.body
    })
    expect(wrapper.get('.notice-body .extra').text()).toContain('/tmp/backup.json')
    expect(wrapper.find('.notice-count').exists()).toBe(false)
  })
})

describe('notice integration', () => {
  it('hides the plugin notice without errors and shows details with them', () => {
    const clean = mount(PluginSection, { props: { state: makeState() } })
    expect(clean.find('.notice').exists()).toBe(false)
    clean.unmount()

    const failing = makeState({
      runtime: {
        ...makeState().runtime,
        errors: [{ code: 'PLUGIN_ERROR', message: '加载 bad.js 失败', details: 'SyntaxError' }]
      }
    })
    wrapper = mount(PluginSection, { props: { state: failing }, attachTo: document.body })
    expect(wrapper.get('.notice-summary').text()).toContain('插件加载错误')
    expect(wrapper.get('.notice-body').text()).toContain('SyntaxError')
  })

  it('collapses connection errors into one notice', () => {
    const clean = mount(ConnectionSection, { props: { state: makeState() } })
    expect(clean.find('.notice').exists()).toBe(false)
    clean.unmount()

    const failing = makeState({
      runtime: {
        ...makeState().runtime,
        errors: [
          { code: 'SERVER_ERROR', message: '端口被占用' },
          { code: 'UNAUTHORIZED', message: '令牌不匹配' }
        ]
      }
    })
    wrapper = mount(ConnectionSection, { props: { state: failing }, attachTo: document.body })
    expect(wrapper.get('.notice-summary').text()).toContain('最近的连接错误')
    expect(wrapper.get('.notice-count').text()).toBe('2 条')
  })
})
