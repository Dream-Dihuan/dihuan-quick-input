import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '@shared/config'
import { normalizeSettingsState } from '../../../src/renderer/src/settings/normalize-state'

function legacySnapshot(): Record<string, unknown> {
  const config = createDefaultConfig('a'.repeat(32)) as unknown as Record<string, unknown>
  config.aliases = [{ id: 'a1', command: 'name', value: '张三', enabled: true }]
  return {
    config,
    plugins: [],
    pluginDirectory: '/tmp/plugins',
    commands: [{ command: 'name', source: 'alias' }],
    conflicts: [],
    connections: [],
    runtime: { port: 47821, hotkey: 'CommandOrControl+Space', hotkeyRegistered: true }
  }
}

describe('settings state normalization', () => {
  it('fills folders and root folder ids for a pre-folder snapshot', () => {
    const normalized = normalizeSettingsState(legacySnapshot())
    expect(normalized).not.toBeNull()
    expect(normalized?.folders).toEqual([])
    expect(normalized?.folderTree).toEqual([])
    expect(normalized?.config.aliases).toEqual([
      { id: 'a1', command: 'name', value: '张三', enabled: true, folderId: null }
    ])
    expect(normalized?.config.version).toBe(2)
    expect(normalized?.runtime.configWarnings).toEqual([])
  })

  it('rebuilds the nested folder tree when the snapshot omits it', () => {
    const snapshot = legacySnapshot()
    const config = snapshot.config as Record<string, unknown>
    config.folders = [
      { id: 'f1', name: 'Work', parentId: null },
      { id: 'f2', name: 'Drafts', parentId: 'f1' }
    ]
    config.aliases = [{ id: 'a1', command: 'name', value: '张三', enabled: true, folderId: 'f2' }]

    const normalized = normalizeSettingsState(snapshot)
    expect(normalized?.folderTree).toHaveLength(1)
    expect(normalized?.folderTree[0]).toMatchObject({ id: 'f1', name: 'Work' })
    expect(normalized?.folderTree[0]?.children[0]).toMatchObject({ id: 'f2', name: 'Drafts' })
    expect(normalized?.folderTree[0]?.children[0]?.aliases.map((alias) => alias.command)).toEqual([
      'name'
    ])
  })

  it('drops unusable mappings and folders instead of throwing', () => {
    const snapshot = legacySnapshot()
    const config = snapshot.config as Record<string, unknown>
    config.aliases = [
      { id: 'ok', command: 'name', value: '张三', enabled: true },
      { command: 'missing-id', value: 'x' },
      null,
      'nope'
    ]
    config.folders = [{ name: 'no id' }, { id: 'f1', name: 'Work', parentId: 'f1' }]

    const normalized = normalizeSettingsState(snapshot)
    expect(normalized?.config.aliases.map((alias) => alias.id)).toEqual(['ok'])
    expect(normalized?.folders.map((folder) => folder.id)).toEqual(['f1'])
  })

  it('rejects snapshots without a config payload', () => {
    expect(normalizeSettingsState(null)).toBeNull()
    expect(normalizeSettingsState('nope')).toBeNull()
    expect(normalizeSettingsState({ runtime: {} })).toBeNull()
  })
})
