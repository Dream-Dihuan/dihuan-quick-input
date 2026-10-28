import { describe, expect, it } from 'vitest'
import type { Alias, Folder } from '@shared/config'
import {
  buildFolderTreeRows,
  canMoveFolder,
  descendantFolderIds,
  folderPath,
  nextFolderName
} from '../../../src/renderer/src/settings/folder-tree'

function alias(command: string, folderId: string | null): Alias {
  return { id: `alias-${command}`, command, value: command, enabled: true, folderId }
}

const folders: Folder[] = [
  { id: 'work', name: 'Work', parentId: null },
  { id: 'drafts', name: 'Drafts', parentId: 'work' },
  { id: 'home', name: 'Home', parentId: null }
]

const aliases: Alias[] = [
  alias('root-one', null),
  alias('work-one', 'work'),
  alias('draft-one', 'drafts'),
  alias('home-one', 'home')
]

describe('folder tree rows', () => {
  it('renders folders depth-first and root mappings last', () => {
    const rows = buildFolderTreeRows(folders, aliases, new Set(['work', 'drafts', 'home']))
    expect(
      rows.map((row) => [row.kind, row.kind === 'folder' ? row.name : row.alias.command])
    ).toEqual([
      ['folder', 'Home'],
      ['alias', 'home-one'],
      ['folder', 'Work'],
      ['alias', 'work-one'],
      ['folder', 'Drafts'],
      ['alias', 'draft-one'],
      ['alias', 'root-one']
    ])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 0, 1, 1, 2, 0])
  })

  it('hides aliases and child folders of a collapsed folder', () => {
    const rows = buildFolderTreeRows(folders, aliases, new Set())
    expect(rows.map((row) => row.id)).toEqual(['home', 'work', 'alias-root-one'])
    const work = rows.find((row) => row.id === 'work')
    expect(work).toMatchObject({ kind: 'folder', expanded: false, aliasCount: 1 })
  })

  it('counts only direct mappings on a folder row', () => {
    const rows = buildFolderTreeRows(folders, aliases, new Set(['work', 'drafts']))
    expect(rows.find((row) => row.id === 'work')).toMatchObject({ aliasCount: 1 })
    expect(rows.find((row) => row.id === 'drafts')).toMatchObject({ aliasCount: 1 })
  })

  it('shows mappings whose folder is missing at root instead of dropping them', () => {
    const rows = buildFolderTreeRows(folders, [...aliases, alias('orphan', 'gone')], new Set())
    expect(rows.some((row) => row.kind === 'alias' && row.alias.command === 'orphan')).toBe(true)
  })

  it('survives parent cycles without hanging', () => {
    const cyclic: Folder[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' }
    ]
    const rows = buildFolderTreeRows(cyclic, [], new Set(['a', 'b']))
    expect(rows).toHaveLength(0)
  })
})

describe('folder path', () => {
  it('joins ancestors from the root down', () => {
    expect(folderPath(folders, 'drafts')).toBe('Work / Drafts')
    expect(folderPath(folders, 'home')).toBe('Home')
  })

  it('falls back to the root label for null or missing folders', () => {
    expect(folderPath(folders, null)).toBe('根目录')
    expect(folderPath(folders, 'missing')).toBe('根目录')
  })
})

describe('folder moves', () => {
  it('collects the folder and all of its descendants', () => {
    expect([...descendantFolderIds(folders, 'work')].sort()).toEqual(['drafts', 'work'])
  })

  it('rejects dropping a folder into itself or a descendant', () => {
    expect(canMoveFolder(folders, 'work', 'work')).toBe(false)
    expect(canMoveFolder(folders, 'work', 'drafts')).toBe(false)
    expect(canMoveFolder(folders, 'work', 'home')).toBe(true)
    expect(canMoveFolder(folders, 'work', null)).toBe(true)
  })
})

describe('default folder names', () => {
  it('adds a numeric suffix when the name is already taken at that level', () => {
    expect(nextFolderName(folders, null, '工作')).toBe('工作')
    expect(nextFolderName(folders, null, 'Work')).toBe('Work 2')
    expect(nextFolderName(folders, 'work', '新建文件夹')).toBe('新建文件夹')
  })

  it('treats sibling names case-insensitively', () => {
    const siblings: Folder[] = [{ id: 'a', name: 'Work', parentId: null }]
    expect(nextFolderName(siblings, null, 'work')).toBe('work 2')
  })
})
