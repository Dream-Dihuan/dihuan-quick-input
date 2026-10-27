import type { Alias } from '@shared/config'
import type { CommandConflict, CommandSummary } from '@shared/ipc'
import { builtinCommands, createBuiltinMap } from './builtins'
import { asciiLowerCase } from './parser'
import type { BuiltinCommand, CommandLookup, LoadedPlugin } from './types'

interface PluginCommandEntry {
  plugin: LoadedPlugin
  command: string
}

export class CommandRegistry {
  private readonly builtinMap: Map<string, BuiltinCommand>
  private aliases = new Map<string, Alias>()
  private plugins: LoadedPlugin[] = []
  private pluginCommands = new Map<string, PluginCommandEntry>()
  private conflictList: CommandConflict[] = []
  private commandList: CommandSummary[] = []

  constructor(builtins: readonly BuiltinCommand[] = builtinCommands) {
    this.builtinMap = createBuiltinMap(builtins)
    this.update([], [])
  }

  update(aliases: Alias[], plugins: LoadedPlugin[]): void {
    const nextAliases = new Map<string, Alias>()
    for (const alias of aliases) {
      if (!alias.enabled) continue
      const name = asciiLowerCase(alias.command)
      if (!name || nextAliases.has(name)) continue
      nextAliases.set(name, alias)
    }
    this.aliases = nextAliases

    const sortedPlugins = [...plugins].sort((left, right) => left.file.localeCompare(right.file))
    this.plugins = sortedPlugins
    const nextPluginCommands = new Map<string, PluginCommandEntry>()
    for (const plugin of sortedPlugins) {
      for (const rawCommand of plugin.commands) {
        const command = asciiLowerCase(rawCommand)
        if (!command || nextPluginCommands.has(command)) continue
        nextPluginCommands.set(command, { plugin, command })
      }
    }
    this.pluginCommands = nextPluginCommands

    this.conflictList = this.buildConflicts()
    this.commandList = this.buildCommandList()
  }

  find(name: string): CommandLookup | undefined {
    const command = asciiLowerCase(name)
    const alias = this.aliases.get(command)
    if (alias) {
      return { name: command, source: 'alias', aliasValue: alias.value }
    }

    const pluginEntry = this.pluginCommands.get(command)
    if (pluginEntry) {
      return {
        name: command,
        source: 'plugin',
        plugin: pluginEntry.plugin
      }
    }

    const builtin = this.builtinMap.get(command)
    if (builtin) {
      return { name: command, source: 'builtin', builtin }
    }

    return undefined
  }

  list(): CommandSummary[] {
    return this.commandList.map((entry) => ({ ...entry }))
  }

  getConflicts(): CommandConflict[] {
    return this.conflictList.map((conflict) => ({
      ...conflict,
      sources: [...conflict.sources],
      ...(conflict.plugins ? { plugins: [...conflict.plugins] } : {})
    }))
  }

  getPlugins(): LoadedPlugin[] {
    return [...this.plugins]
  }

  private buildConflicts(): CommandConflict[] {
    const sources = new Map<string, { alias?: boolean; plugin: string[]; builtin?: boolean }>()

    const ensure = (command: string): { alias?: boolean; plugin: string[]; builtin?: boolean } => {
      let entry = sources.get(command)
      if (!entry) {
        entry = { plugin: [] }
        sources.set(command, entry)
      }
      return entry
    }

    for (const [command] of this.aliases) {
      ensure(command).alias = true
    }
    for (const plugin of this.plugins) {
      for (const rawCommand of plugin.commands) {
        const command = asciiLowerCase(rawCommand)
        if (!command) continue
        ensure(command).plugin.push(plugin.name || plugin.file)
      }
    }
    for (const command of this.builtinMap.keys()) {
      ensure(command).builtin = true
    }

    const conflicts: CommandConflict[] = []
    for (const [command, entry] of sources) {
      const distinctPlugins = [...new Set(entry.plugin)]
      const sourceKinds: CommandConflict['sources'] = []
      if (entry.alias) sourceKinds.push('alias')
      if (distinctPlugins.length > 0) sourceKinds.push('plugin')
      if (entry.builtin) sourceKinds.push('builtin')

      if (sourceKinds.length > 1 || distinctPlugins.length > 1) {
        conflicts.push({
          command,
          sources: sourceKinds,
          ...(distinctPlugins.length > 0 ? { plugins: distinctPlugins } : {})
        })
      }
    }

    return conflicts.sort((left, right) => left.command.localeCompare(right.command))
  }

  private buildCommandList(): CommandSummary[] {
    const commands = new Set<string>([
      ...this.aliases.keys(),
      ...this.pluginCommands.keys(),
      ...this.builtinMap.keys()
    ])

    return [...commands]
      .sort((left, right) => left.localeCompare(right))
      .map((command) => {
        const alias = this.aliases.get(command)
        if (alias) {
          return { command, source: 'alias' as const }
        }
        const pluginEntry = this.pluginCommands.get(command)
        if (pluginEntry) {
          return {
            command,
            source: 'plugin' as const,
            plugin: pluginEntry.plugin.name || pluginEntry.plugin.file
          }
        }
        return { command, source: 'builtin' as const }
      })
  }
}
