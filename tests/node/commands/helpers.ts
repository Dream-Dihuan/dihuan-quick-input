import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Alias } from '@shared/config'
import type { LoadedPlugin } from '../../../src/main/commands/types'

export function makeAlias(id: string, command: string, value: string, enabled = true): Alias {
  return { id, command, value, enabled }
}

export function makePlugin(
  file: string,
  name: string,
  handlers: Record<string, (args: string[]) => string>
): LoadedPlugin {
  return {
    file,
    name,
    commands: Object.keys(handlers).sort(),
    execute(command, args) {
      const handler = handlers[command]
      if (!handler) throw new Error(`missing handler ${command}`)
      return handler(args)
    }
  }
}

export async function temporaryPluginDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dqi-plugins-'))
}

export async function removeDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export async function writePlugin(directory: string, file: string, source: string): Promise<void> {
  await writeFile(join(directory, file), source, 'utf8')
}
