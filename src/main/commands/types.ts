import type { AppErrorInfo, ErrorCode } from '@shared/errors'

export type CommandSource = 'alias' | 'plugin' | 'builtin'

export interface ParsedCommand {
  name: string
  args: string[]
  rawArgs: string
}

export interface CommandContext {
  rawArgs: string
  now: Date
  locale: string
  randomUUID?: () => string
}

export interface BuiltinCommand {
  name: string
  description: string
  execute: (args: string[], context: CommandContext) => string
}

export interface PluginCommandContext {
  rawArgs: string
  now: string
  locale: string
}

export interface LoadedPlugin {
  file: string
  name: string
  commands: string[]
  execute: (command: string, args: string[], context: PluginCommandContext) => string
}

export interface CommandLookup {
  name: string
  source: CommandSource
  plugin?: LoadedPlugin
  builtin?: BuiltinCommand
  aliasValue?: string
}

export interface CommandSuccess {
  ok: true
  command: string
  source: CommandSource
  plugin?: string
  text: string
  durationMs: number
}

export interface CommandFailure {
  ok: false
  command?: string
  source?: CommandSource
  plugin?: string
  error: AppErrorInfo
  durationMs: number
}

export type CommandResult = CommandSuccess | CommandFailure

export class CommandError extends Error {
  readonly code: ErrorCode
  readonly details?: string

  constructor(code: ErrorCode, message: string, details?: string) {
    super(message)
    this.name = 'CommandError'
    this.code = code
    this.details = details
  }
}

export interface ResolveOptions {
  now?: Date
  locale?: string
  randomUUID?: () => string
}
