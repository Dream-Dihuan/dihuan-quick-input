import { describe, expect, it } from 'vitest'
import { builtinCommands } from '../../../src/main/commands/builtins'
import {
  CommandError,
  type BuiltinCommand,
  type CommandContext
} from '../../../src/main/commands/types'

function builtin(name: string): BuiltinCommand {
  const command = builtinCommands.find((item) => item.name === name)
  if (!command) throw new Error(`missing builtin ${name}`)
  return command
}

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    rawArgs: '',
    now: new Date(2026, 9, 27, 9, 5, 6),
    locale: 'zh-CN',
    ...overrides
  }
}

function expectError(code: string, run: () => unknown): void {
  try {
    run()
    throw new Error('expected an error')
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError)
    expect((error as CommandError).code).toBe(code)
  }
}

describe('builtin commands', () => {
  it('formats age', () => {
    expect(builtin('age').execute(['19'], context())).toBe('19 岁')
    expect(builtin('age').execute(['0'], context())).toBe('0 岁')
    expect(builtin('age').execute(['019'], context())).toBe('19 岁')
  })

  it('validates age arguments', () => {
    expectError('INVALID_ARGS', () => builtin('age').execute([], context()))
    expectError('INVALID_ARGS', () => builtin('age').execute(['abc'], context()))
    expectError('INVALID_ARGS', () => builtin('age').execute(['-1'], context()))
    expectError('INVALID_ARGS', () => builtin('age').execute(['1.5'], context()))
    expectError('INVALID_ARGS', () => builtin('age').execute(['1', '2'], context()))
  })

  it('formats local date and time', () => {
    expect(builtin('date').execute([], context())).toBe('2026-10-27')
    expect(builtin('time').execute([], context())).toBe('09:05')
  })

  it('rejects arguments for date and time', () => {
    expectError('INVALID_ARGS', () => builtin('date').execute(['x'], context()))
    expectError('INVALID_ARGS', () => builtin('time').execute(['x'], context()))
  })

  it('uses the injected UUID implementation', () => {
    const uuid = builtin('uuid')
    expect(
      uuid.execute([], context({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }))
    ).toBe('00000000-0000-4000-8000-000000000000')
    expect(uuid.execute([], context())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expectError('INVALID_ARGS', () => uuid.execute(['x'], context()))
  })

  it('converts case and joins multiple arguments', () => {
    expect(builtin('upper').execute(['Alice', 'Smith'], context())).toBe('ALICE SMITH')
    expect(builtin('lower').execute(['Alice', 'Smith'], context())).toBe('alice smith')
    expectError('INVALID_ARGS', () => builtin('upper').execute([], context()))
    expectError('INVALID_ARGS', () => builtin('lower').execute([], context()))
  })
})
