import type { Alias, Folder } from '@shared/config'

export interface FolderTreeFolderRow {
  kind: 'folder'
  id: string
  name: string
  depth: number
  aliasCount: number
  expanded: boolean
}

export interface FolderTreeAliasRow {
  kind: 'alias'
  id: string
  alias: Alias
  depth: number
}

export type FolderTreeRow = FolderTreeFolderRow | FolderTreeAliasRow

function parentOf(folder: Folder): string | null {
  return folder.parentId ?? null
}

/**
 * Flattens the folder tree into display rows: every folder is emitted once,
 * children are indented by depth, and a collapsed folder hides its aliases and
 * its whole subtree. Root-level mappings are emitted last so folders stay on top.
 *
 * With a non-empty `query` the tree switches to filtered mode: only mappings
 * whose command or value matches (case-insensitive) are listed, their ancestor
 * folders are kept and always shown expanded, and collapsing is ignored.
 */
export function buildFolderTreeRows(
  folders: Folder[],
  aliases: Alias[],
  expanded: ReadonlySet<string>,
  query = ''
): FolderTreeRow[] {
  const needle = query.trim().toLowerCase()
  if (needle.length > 0) return buildFilteredRows(folders, aliases, needle)

  const rows: FolderTreeRow[] = []
  // Guards against corrupt data where a parent reference points at itself or loops.
  const visited = new Set<string>()

  const walk = (parentId: string | null, depth: number): void => {
    const children = folders
      .filter((folder) => parentOf(folder) === parentId && !visited.has(folder.id))
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const folder of children) {
      visited.add(folder.id)
      const folderAliases = aliases.filter((alias) => (alias.folderId ?? null) === folder.id)
      const open = expanded.has(folder.id)
      rows.push({
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        depth,
        aliasCount: folderAliases.length,
        expanded: open
      })
      if (!open) continue
      for (const alias of folderAliases) {
        rows.push({ kind: 'alias', id: alias.id, alias, depth: depth + 1 })
      }
      walk(folder.id, depth + 1)
    }
  }

  walk(null, 0)

  // Mappings whose folder is missing (corrupt config or stale state) still
  // render at root instead of silently disappearing.
  const known = new Set(folders.map((folder) => folder.id))
  for (const alias of aliases) {
    if (!alias.folderId || !known.has(alias.folderId)) {
      rows.push({ kind: 'alias', id: alias.id, alias, depth: 0 })
    }
  }

  return rows
}

function buildFilteredRows(folders: Folder[], aliases: Alias[], needle: string): FolderTreeRow[] {
  const matches = (alias: Alias): boolean =>
    alias.command.toLowerCase().includes(needle) || alias.value.toLowerCase().includes(needle)
  const matched = aliases.filter(matches)
  if (matched.length === 0) return []

  const ancestors = new Set<string>()
  for (const alias of matched) {
    let current = alias.folderId ?? null
    const guard = new Set<string>()
    while (current && !guard.has(current)) {
      guard.add(current)
      ancestors.add(current)
      current = folders.find((folder) => folder.id === current)?.parentId ?? null
    }
  }

  const rows: FolderTreeRow[] = []
  const visited = new Set<string>()
  const walk = (parentId: string | null, depth: number): void => {
    const children = folders
      .filter(
        (folder) =>
          parentOf(folder) === parentId && ancestors.has(folder.id) && !visited.has(folder.id)
      )
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const folder of children) {
      visited.add(folder.id)
      const folderMatches = matched.filter((alias) => (alias.folderId ?? null) === folder.id)
      rows.push({
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        depth,
        aliasCount: folderMatches.length,
        expanded: true
      })
      for (const alias of folderMatches) {
        rows.push({ kind: 'alias', id: alias.id, alias, depth: depth + 1 })
      }
      walk(folder.id, depth + 1)
    }
  }

  walk(null, 0)

  const known = new Set(folders.map((folder) => folder.id))
  for (const alias of matched) {
    if (!alias.folderId || !known.has(alias.folderId)) {
      rows.push({ kind: 'alias', id: alias.id, alias, depth: 0 })
    }
  }

  return rows
}

/** Human readable folder path, used to show where a new mapping will land. */
export function folderPath(folders: Folder[], folderId: string | null): string {
  const parts: string[] = []
  const guard = new Set<string>()
  let current = folderId
  while (current && !guard.has(current)) {
    guard.add(current)
    const folder = folders.find((item) => item.id === current)
    if (!folder) break
    parts.unshift(folder.name)
    current = folder.parentId ?? null
  }
  return parts.length > 0 ? parts.join(' / ') : '根目录'
}

/** The folder itself plus every transitive child folder. */
export function descendantFolderIds(folders: Folder[], folderId: string): Set<string> {
  const result = new Set<string>([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id)
        changed = true
      }
    }
  }
  return result
}

/** Rejects dropping a folder onto itself or one of its own descendants. */
export function canMoveFolder(
  folders: Folder[],
  folderId: string,
  targetParentId: string | null
): boolean {
  if (folderId === targetParentId) return false
  if (targetParentId === null) return true
  return !descendantFolderIds(folders, folderId).has(targetParentId)
}

/** Generates a sibling-unique default name such as 新建文件夹 2. */
export function nextFolderName(
  folders: Folder[],
  parentId: string | null,
  base = '新建文件夹'
): string {
  const taken = new Set(
    folders
      .filter((folder) => (folder.parentId ?? null) === parentId)
      .map((folder) => folder.name.toLowerCase())
  )
  if (!taken.has(base.toLowerCase())) return base
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${Date.now()}`
}
