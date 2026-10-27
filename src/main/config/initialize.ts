import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ConfigStore, type ConfigLoadResult, type ConfigStoreOptions } from './config-store'
import { PLUGIN_README_CONTENT } from './plugin-readme'

export interface AppDataPaths {
  userDataDirectory: string
  configPath: string
  pluginsDirectory: string
  pluginsReadmePath: string
}

export interface InitializedAppData {
  paths: AppDataPaths
  store: ConfigStore
  loadResult: ConfigLoadResult
  warnings: string[]
}

export function resolveAppDataPaths(userDataDirectory: string): AppDataPaths {
  const configPath = join(userDataDirectory, 'config.json')
  const pluginsDirectory = join(userDataDirectory, 'plugins')
  return {
    userDataDirectory,
    configPath,
    pluginsDirectory,
    pluginsReadmePath: join(pluginsDirectory, 'README.md')
  }
}

export async function initializeAppData(
  userDataDirectory: string,
  options: ConfigStoreOptions = {}
): Promise<InitializedAppData> {
  const paths = resolveAppDataPaths(userDataDirectory)
  const warnings: string[] = []

  await mkdir(paths.pluginsDirectory, { recursive: true })

  try {
    await writeFile(paths.pluginsReadmePath, PLUGIN_README_CONTENT, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      warnings.push(
        `插件目录说明写入失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const store = new ConfigStore(paths.configPath, options)
  const loadResult = await store.load()

  return {
    paths,
    store,
    loadResult,
    warnings: [...warnings, ...loadResult.warnings]
  }
}
