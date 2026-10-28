import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultConfig } from '@shared/config'
import { ConfigStore } from '../../../src/main/config/config-store'

const FIXED_TOKEN = 'fixed-token-0123456789abcdef0123456789'

describe('config store', () => {
  let directory: string
  let configPath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dqi-config-'))
    configPath = join(directory, 'config.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function store(token = FIXED_TOKEN): ConfigStore {
    return new ConfigStore(configPath, {
      generateToken: () => token,
      now: () => new Date('2026-10-27T09:05:06.000Z')
    })
  }

  it('creates a default config file with safe permissions', async () => {
    const result = await store().load()
    expect(result.status).toBe('created')
    expect(result.config).toEqual(createDefaultConfig(FIXED_TOKEN))
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(result.config)
    if (process.platform !== 'win32') {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('keeps the same token when reloaded', async () => {
    const first = await store('token-one-0123456789abcdef').load()
    const second = await store('token-two-0123456789abcdef').load()
    expect(first.config.server.token).toBe('token-one-0123456789abcdef')
    expect(second.config.server.token).toBe(first.config.server.token)
    expect(second.status).toBe('ok')
  })

  it('persists valid changes across restarts', async () => {
    const config = createDefaultConfig(FIXED_TOKEN)
    config.hotkey = 'CommandOrControl+Alt+Space'
    config.insertMode = 'replace'
    config.aliases = [{ id: 'a1', command: 'name', value: '张三', enabled: true, folderId: null }]
    await store().save(config)

    const reloaded = await store().load()
    expect(reloaded.status).toBe('ok')
    expect(reloaded.config).toEqual(config)
  })

  it('backs up invalid JSON and recovers defaults', async () => {
    await writeFile(configPath, '{ definitely not json', 'utf8')
    const result = await store().load()

    expect(result.status).toBe('recovered')
    expect(result.config).toEqual(createDefaultConfig(FIXED_TOKEN))
    expect(result.warnings.join('\n')).toContain('JSON')
    expect(result.backupPath).toBe(join(directory, 'config.corrupt-2026-10-27T09-05-06-000Z.json'))
    expect(await readFile(result.backupPath!, 'utf8')).toBe('{ definitely not json')
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(result.config)
  })

  it('recovers from an unsupported future version', async () => {
    const future = { ...createDefaultConfig(FIXED_TOKEN), version: 3 }
    await writeFile(configPath, JSON.stringify(future), 'utf8')
    const result = await store().load()

    expect(result.status).toBe('recovered')
    expect(result.config.version).toBe(2)
    expect(result.backupPath).toBeTruthy()
    expect(result.warnings.join('\n')).toContain('高于当前支持')
  })

  it('keeps valid fields and drops invalid aliases from partial configs', async () => {
    const partial = {
      ...createDefaultConfig(FIXED_TOKEN),
      hotkey: 'CommandOrControl+Alt+Space',
      insertMode: 'replace',
      aliases: [
        { id: 'a1', command: 'name', value: '张三', enabled: true, folderId: null },
        { id: 'a2', command: 'email', enabled: true },
        { id: 'a3', command: 'NAME', value: '李四', enabled: true }
      ]
    }
    await writeFile(configPath, JSON.stringify(partial), 'utf8')
    const result = await store().load()

    expect(result.status).toBe('partial')
    expect(result.config.hotkey).toBe('CommandOrControl+Alt+Space')
    expect(result.config.insertMode).toBe('replace')
    expect(result.config.aliases).toEqual([
      { id: 'a1', command: 'name', value: '张三', enabled: true, folderId: null }
    ])
    expect(result.warnings.length).toBeGreaterThan(0)

    const reloaded = await store().load()
    expect(reloaded.status).toBe('ok')
    expect(reloaded.config.aliases).toEqual(result.config.aliases)
  })

  it('adds a version warning and repairs configs without a version', async () => {
    const withoutVersion: Record<string, unknown> = { ...createDefaultConfig(FIXED_TOKEN) }
    delete withoutVersion.version
    await writeFile(configPath, JSON.stringify(withoutVersion), 'utf8')
    const result = await store().load()

    expect(result.status).toBe('partial')
    expect(result.config.version).toBe(2)
    expect(result.warnings.join('\n')).toContain('缺少版本号')
  })

  it('migrates a version 1 flat configuration to folders and root mappings', async () => {
    const legacy = {
      version: 1,
      onboardingComplete: true,
      hotkey: 'CommandOrControl+Shift+Space',
      insertMode: 'caret',
      launchAtLogin: false,
      server: { token: FIXED_TOKEN },
      plugins: { enabled: true },
      aliases: [{ id: 'a1', command: 'name', value: '张三', enabled: true }]
    }
    await writeFile(configPath, JSON.stringify(legacy), 'utf8')
    const result = await store().load()

    expect(result.status).toBe('ok')
    expect(result.config.version).toBe(2)
    expect(result.config.folders).toEqual([])
    expect(result.config.aliases).toEqual([
      { id: 'a1', command: 'name', value: '张三', enabled: true, folderId: null }
    ])
  })

  it('persists folders and mapping folder ids across restarts', async () => {
    const config = createDefaultConfig(FIXED_TOKEN)
    config.folders = [
      { id: 'f1', name: 'Work', parentId: null },
      { id: 'f2', name: 'Drafts', parentId: 'f1' }
    ]
    config.aliases = [{ id: 'a1', command: 'name', value: '张三', enabled: true, folderId: 'f2' }]
    await store().save(config)

    const reloaded = await store().load()
    expect(reloaded.status).toBe('ok')
    expect(reloaded.config).toEqual(config)
  })

  it('rejects invalid writes', async () => {
    const invalid = createDefaultConfig(FIXED_TOKEN)
    invalid.server.token = 'short'
    await expect(store().save(invalid)).rejects.toThrow()
  })
})
