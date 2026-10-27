import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeAppData } from '../../../src/main/config/initialize'
import { PLUGIN_README_CONTENT } from '../../../src/main/config/plugin-readme'

const TOKEN = 'init-token-0123456789abcdef0123456789'

describe('app data initialization', () => {
  let userData: string

  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'dqi-user-data-'))
  })

  afterEach(async () => {
    await rm(userData, { recursive: true, force: true })
  })

  async function initialize(): Promise<Awaited<ReturnType<typeof initializeAppData>>> {
    return initializeAppData(userData, { generateToken: () => TOKEN })
  }

  it('creates the config, plugin directory and README', async () => {
    const initialized = await initialize()

    expect(initialized.paths.configPath).toBe(join(userData, 'config.json'))
    expect(initialized.paths.pluginsDirectory).toBe(join(userData, 'plugins'))
    expect(await readFile(initialized.paths.configPath, 'utf8')).toContain(TOKEN)
    expect(await readFile(initialized.paths.pluginsReadmePath, 'utf8')).toBe(PLUGIN_README_CONTENT)
    expect(initialized.loadResult.status).toBe('created')
  })

  it('does not overwrite an existing README or config', async () => {
    const first = await initialize()
    await writeFile(first.paths.pluginsReadmePath, 'custom readme', 'utf8')
    const firstConfig = await readFile(first.paths.configPath, 'utf8')

    const second = await initializeAppData(userData, {
      generateToken: () => 'different-token-0123456789abcdef'
    })
    expect(await readFile(second.paths.pluginsReadmePath, 'utf8')).toBe('custom readme')
    expect(await readFile(second.paths.configPath, 'utf8')).toBe(firstConfig)
    expect(second.loadResult.status).toBe('ok')
  })
})
