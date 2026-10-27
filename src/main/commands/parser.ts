import type { ParsedCommand } from './types'

export class CommandParseError extends Error {
  readonly code = 'INVALID_ARGS'

  constructor(message: string) {
    super(message)
    this.name = 'CommandParseError'
  }
}

export function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32))
}

/**
 * Parse a shell-like command line. Whitespace separates tokens, single and
 * double quotes preserve spaces, and a backslash escapes the next character.
 */
export function parseCommand(input: string): ParsedCommand | null {
  const tokens: string[] = []
  let current = ''
  let tokenStarted = false
  let quote: "'" | '"' | null = null
  let commandEnd = input.length
  let commandCaptured = false

  const finishToken = (index: number): void => {
    tokens.push(current)
    if (!commandCaptured) {
      commandCaptured = true
      commandEnd = index
    }
    current = ''
    tokenStarted = false
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]

    if (quote === "'") {
      if (character === "'") {
        quote = null
      } else {
        current += character
      }
      tokenStarted = true
      continue
    }

    if (quote === '"') {
      if (character === '"') {
        quote = null
      } else if (character === '\\') {
        const next = input[index + 1]
        if (next === undefined) {
          throw new CommandParseError('命令末尾的反斜杠需要转义字符')
        }
        current += next
        index += 1
      } else {
        current += character
      }
      tokenStarted = true
      continue
    }

    if (character === "'" || character === '"') {
      quote = character
      tokenStarted = true
      continue
    }

    if (character === '\\') {
      const next = input[index + 1]
      if (next === undefined) {
        throw new CommandParseError('命令末尾的反斜杠需要转义字符')
      }
      current += next
      tokenStarted = true
      index += 1
      continue
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        finishToken(index)
      }
      continue
    }

    current += character
    tokenStarted = true
  }

  if (quote !== null) {
    throw new CommandParseError('引号未闭合')
  }

  if (tokenStarted) {
    finishToken(input.length)
  }

  if (tokens.length === 0) {
    return null
  }

  const name = tokens[0]
  if (!name) {
    throw new CommandParseError('命令名不能为空')
  }

  return {
    name: asciiLowerCase(name),
    args: tokens.slice(1),
    rawArgs: input.slice(commandEnd).trim()
  }
}
