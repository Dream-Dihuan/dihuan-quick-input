import { describe, expect, it } from 'vitest'
import { CommandParseError, parseCommand } from '../../../src/main/commands/parser'

describe('command parser', () => {
  it('parses a command without arguments', () => {
    expect(parseCommand('name')).toEqual({ name: 'name', args: [], rawArgs: '' })
  })

  it('parses arguments separated by whitespace', () => {
    expect(parseCommand('age 19')).toEqual({
      name: 'age',
      args: ['19'],
      rawArgs: '19'
    })
    expect(parseCommand('  age   19  ')).toEqual({
      name: 'age',
      args: ['19'],
      rawArgs: '19'
    })
  })

  it('keeps spaces inside double and single quotes', () => {
    expect(parseCommand('greet "Alice Smith"')?.args).toEqual(['Alice Smith'])
    expect(parseCommand("greet 'Alice Smith'")?.args).toEqual(['Alice Smith'])
  })

  it('supports backslash escapes', () => {
    expect(parseCommand('greet Alice\\ Smith')?.args).toEqual(['Alice Smith'])
    expect(parseCommand('greet "Alice \\"Ace\\" Smith"')?.args).toEqual(['Alice "Ace" Smith'])
  })

  it('preserves empty quoted arguments', () => {
    expect(parseCommand('greet ""')?.args).toEqual([''])
  })

  it('normalizes only ASCII letters in the command name', () => {
    expect(parseCommand('NAME')?.name).toBe('name')
    expect(parseCommand('ÜBER')?.name).toBe('Über')
  })

  it('returns null for empty and whitespace-only input', () => {
    expect(parseCommand('')).toBeNull()
    expect(parseCommand('   \t\n')).toBeNull()
  })

  it('reports unterminated quotes and dangling escapes', () => {
    expect(() => parseCommand('greet "Alice')).toThrow(CommandParseError)
    expect(() => parseCommand('greet Alice\\')).toThrow(CommandParseError)
    expect(() => parseCommand("greet 'Alice")).toThrow(CommandParseError)
  })

  it('tracks raw arguments after the command name', () => {
    expect(parseCommand('greet "Alice Smith" 42')?.rawArgs).toBe('"Alice Smith" 42')
  })
})
