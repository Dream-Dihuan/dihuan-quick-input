import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createDefaultConfig, type AppConfig } from '@shared/config'
import type { SettingsState } from '@shared/ipc'
import AliasSection from '../../../src/renderer/src/settings/AliasSection.vue'

function makeConfig(): AppConfig {
  const config = createDefaultConfig('a'.repeat(32))
  config.aliases = [
    { id: 'a1', command: 'root', value: 'R', enabled: true, folderId: null },
    { id: 'a2', command: 'inner', value: 'I', enabled: true, folderId: 'f2' }
  ]
  return config
}

function makeState(overrides: Partial<SettingsState> = {}): SettingsState {
  const config = makeConfig()
  return {
    config,
    folders: [
      { id: 'f1', name: '工作', parentId: null },
      { id: 'f2', name: '草稿', parentId: 'f1' }
    ],
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

interface ApiStubs {
  aliasCreate: ReturnType<typeof vi.fn>
  aliasUpdate: ReturnType<typeof vi.fn>
  aliasRemove: ReturnType<typeof vi.fn>
  folderUpdate: ReturnType<typeof vi.fn>
  folderCreate: ReturnType<typeof vi.fn>
  folderRemove: ReturnType<typeof vi.fn>
}

function stubApi(): ApiStubs {
  const stubs: ApiStubs = {
    aliasCreate: vi.fn(async () => ({ ok: true, data: { id: 'a9' } })),
    aliasUpdate: vi.fn(async () => ({ ok: true, data: {} })),
    aliasRemove: vi.fn(async () => ({ ok: true, data: makeState() })),
    folderUpdate: vi.fn(async () => ({ ok: true, data: {} })),
    folderCreate: vi.fn(async () => ({
      ok: true,
      data: { id: 'f9', name: '新建文件夹', parentId: null }
    })),
    folderRemove: vi.fn(async () => ({ ok: true, data: makeState() }))
  }
  vi.stubGlobal(
    'window',
    Object.assign(globalThis.window, {
      api: {
        settings: {
          aliases: {
            update: stubs.aliasUpdate,
            remove: stubs.aliasRemove,
            create: stubs.aliasCreate
          },
          folders: {
            create: stubs.folderCreate,
            update: stubs.folderUpdate,
            remove: stubs.folderRemove
          }
        }
      },
      confirm: () => true
    })
  )
  return stubs
}

let active: ReturnType<typeof mount> | null = null

afterEach(() => {
  active?.unmount()
  active = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function mountSection(state = makeState()): ReturnType<typeof mount> {
  active = mount(AliasSection, { props: { state }, attachTo: document.body })
  return active
}

function menuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.menu-item')]
}

function menuItem(label: string): HTMLElement {
  const element = menuItems().find((item) => item.textContent?.trim() === label)
  if (!element) throw new Error(`没有找到菜单项：${label}`)
  return element
}

function treeText(wrapper: ReturnType<typeof mount>): string {
  return wrapper
    .findAll('li.tree-row')
    .map((row) => row.text())
    .join(' | ')
}

function rowByText(wrapper: ReturnType<typeof mount>, text: string): ReturnType<typeof mount> {
  const row = wrapper.findAll('li.tree-row').find((item) => item.text().includes(text))
  if (!row) throw new Error(`没有找到行：${text}`)
  return row as unknown as ReturnType<typeof mount>
}

describe('AliasSection tree interactions', () => {
  it('keeps child folders collapsed until the parent is expanded', async () => {
    stubApi()
    const wrapper = mountSection()

    expect(treeText(wrapper)).toContain('工作')
    expect(treeText(wrapper)).not.toContain('草稿')

    await rowByText(wrapper, '工作').find('.tree-chevron').trigger('click')

    expect(treeText(wrapper)).toContain('草稿')
    expect(treeText(wrapper)).not.toContain('inner')
  })

  it('expands and collapses a folder by clicking anywhere on its row', async () => {
    stubApi()
    const wrapper = mountSection()
    const row = rowByText(wrapper, '工作')
    expect(row.attributes('aria-expanded')).toBe('false')

    await row.trigger('click')
    expect(treeText(wrapper)).toContain('草稿')
    expect(rowByText(wrapper, '工作').attributes('aria-expanded')).toBe('true')

    await rowByText(wrapper, '工作').trigger('click')
    expect(treeText(wrapper)).not.toContain('草稿')
  })

  it('marks the expanded folder row so the chevron and tint can differ', async () => {
    stubApi()
    const wrapper = mountSection()
    const row = rowByText(wrapper, '工作')

    expect(row.classes()).not.toContain('is-expanded')
    expect(row.find('.tree-chevron svg').exists()).toBe(true)

    await row.trigger('click')

    const expanded = rowByText(wrapper, '工作')
    expect(expanded.classes()).toContain('is-expanded')
    expect(expanded.find('.tree-chevron').attributes('aria-expanded')).toBe('true')
  })

  it('shows the mapping count badge only while the folder is collapsed', async () => {
    stubApi()
    const wrapper = mountSection()

    await rowByText(wrapper, '工作').find('.tree-chevron').trigger('click')
    // 工作 只有草稿这个子文件夹，展开后没有直属映射徽标
    expect(rowByText(wrapper, '工作').find('.tree-count').exists()).toBe(false)
  })

  it('mounts the context menu on body so it can follow the cursor', async () => {
    stubApi()
    const wrapper = mountSection()

    await rowByText(wrapper, '工作').trigger('contextmenu', { clientX: 120, clientY: 90 })

    const menu = document.querySelector('.context-menu')
    expect(menu?.parentElement).toBe(document.body)
    expect(menu?.getAttribute('style')).toContain('left: 120px')
    expect(menu?.getAttribute('style')).toContain('top: 90px')
  })

  it('shows context menu items for folders and mappings', async () => {
    stubApi()
    const wrapper = mountSection()

    await rowByText(wrapper, '工作').trigger('contextmenu', { clientX: 20, clientY: 20 })
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      '新建子文件夹',
      '在此新建映射',
      '粘贴到此处',
      '重命名',
      '剪切',
      '删除文件夹'
    ])

    await rowByText(wrapper, 'root').trigger('contextmenu', { clientX: 20, clientY: 20 })
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      '编辑映射',
      '停用映射',
      '剪切',
      '删除映射'
    ])
  })

  it('cuts a mapping and pastes it into a folder', async () => {
    const api = stubApi()
    const wrapper = mountSection()

    await rowByText(wrapper, 'root').trigger('contextmenu', { clientX: 20, clientY: 20 })
    menuItem('剪切').click()
    await flushPromises()
    expect(wrapper.find('.cut-banner').exists()).toBe(true)

    await rowByText(wrapper, '工作').trigger('contextmenu', { clientX: 20, clientY: 20 })
    menuItem('粘贴到此处').click()
    await flushPromises()

    expect(api.aliasUpdate).toHaveBeenCalledWith({ id: 'a1', folderId: 'f1' })
    expect(wrapper.find('.cut-banner').exists()).toBe(false)
  })

  it('moves a mapping by dragging it onto a folder', async () => {
    const api = stubApi()
    const wrapper = mountSection()

    await rowByText(wrapper, 'root').trigger('dragstart')
    await rowByText(wrapper, '工作').trigger('dragover')
    await rowByText(wrapper, '工作').trigger('drop')
    await flushPromises()

    expect(api.aliasUpdate).toHaveBeenCalledWith({ id: 'a1', folderId: 'f1' })
  })

  it('refuses to drag a folder into its own child', async () => {
    const api = stubApi()
    const wrapper = mountSection()

    await rowByText(wrapper, '工作').trigger('dragstart')
    await rowByText(wrapper, '工作').find('.tree-chevron').trigger('click')
    await rowByText(wrapper, '草稿').trigger('drop')
    await flushPromises()

    expect(api.folderUpdate).not.toHaveBeenCalled()
    expect(wrapper.emitted('feedback')?.at(-1)).toEqual([
      '不能把文件夹移动到自身或它的子文件夹里',
      'error'
    ])
  })

  it('opens the mapping form inside a modal dialog', async () => {
    stubApi()
    const wrapper = mountSection()

    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    await wrapper.find('.heading-actions .button.primary').trigger('click')

    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.find('#alias-command').exists()).toBe(true)
    expect(wrapper.find('.dialog-target').text()).toContain('根目录')
  })

  it('prefills the dialog folder from the selected folder', async () => {
    stubApi()
    const wrapper = mountSection()

    await rowByText(wrapper, '工作').trigger('click')
    await wrapper.find('.heading-actions .button.primary').trigger('click')

    expect(wrapper.find('.dialog-target').text()).toContain('工作')
  })

  it('closes the dialog after saving and refreshes settings', async () => {
    const api = stubApi()
    const wrapper = mountSection()

    await wrapper.find('.heading-actions .button.primary').trigger('click')
    await wrapper.find('#alias-command').setValue('nick')
    await wrapper.find('#alias-value').setValue('小明')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.aliasCreate).toHaveBeenCalledWith({
      command: 'nick',
      value: '小明',
      enabled: true,
      folderId: null
    })
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('keeps the dialog open and shows the error when saving fails', async () => {
    const api = stubApi()
    api.aliasCreate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_PAYLOAD', message: '命令已存在', details: '命令已存在' }
    })
    const wrapper = mountSection()

    await wrapper.find('.heading-actions .button.primary').trigger('click')
    await wrapper.find('#alias-command').setValue('nick')
    await wrapper.find('#alias-value').setValue('小明')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.find('.field-error').text()).toContain('命令已存在')
    expect(wrapper.emitted('refresh')).toBeUndefined()
  })

  it('closes the dialog on Escape', async () => {
    stubApi()
    const wrapper = mountSection()

    await wrapper.find('.heading-actions .button.primary').trigger('click')
    await wrapper.find('dialog').trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
  })

  it('creates a folder and starts inline rename', async () => {
    const api = stubApi()
    const wrapper = mountSection()

    await wrapper.find('.heading-actions .button.ghost').trigger('click')
    await flushPromises()

    expect(api.folderCreate).toHaveBeenCalledWith({ name: '新建文件夹', parentId: null })
    expect(wrapper.emitted('refresh')).toHaveLength(1)

    // In the app the refresh pushes the new folder back through props.
    const refreshed = makeState({
      folders: [
        { id: 'f1', name: '工作', parentId: null },
        { id: 'f2', name: '草稿', parentId: 'f1' },
        { id: 'f9', name: '新建文件夹', parentId: null }
      ]
    })
    await wrapper.setProps({ state: refreshed })
    expect(wrapper.find('#tree-rename-input').exists()).toBe(true)
  })

  it('renames a folder from the context menu', async () => {
    const api = stubApi()
    const wrapper = mountSection()

    await rowByText(wrapper, '工作').trigger('contextmenu', { clientX: 20, clientY: 20 })
    menuItem('重命名').click()
    await flushPromises()
    const input = wrapper.find('#tree-rename-input')
    expect(input.exists()).toBe(true)

    await input.setValue('项目')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(api.folderUpdate).toHaveBeenCalledWith({ id: 'f1', name: '项目' })
  })
})
