import { describe, expect, it } from 'vitest'
import { CommandRegistry } from '../../../src/main/commands/registry'
import { CommandResolver } from '../../../src/main/commands/resolver'
import { CommandError } from '../../../src/main/commands/types'
import { makeAlias, makePlugin } from './helpers'

function createResolver(
  aliases = [] as ReturnType<typeof makeAlias>[],
  plugins = [] as ReturnType<typeof makePlugin>[]
): CommandResolver {
  const registry = new CommandRegistry()
  registry.update(aliases, plugins)
  return new CommandResolver(registry)
}

describe('command resolver', () => {
  it('resolves an alias', () => {
    const resolver = createResolver([makeAlias('a1', 'name', '张三')])
    expect(resolver.resolve('name')).toMatchObject({
      ok: true,
      text: '张三',
      command: 'name',
      source: 'alias'
    })
  })

  it('rejects extra alias arguments', () => {
    const resolver = createResolver([makeAlias('a1', 'name', '张三')])
    expect(resolver.resolve('name extra')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGS' }
    })
    expect(resolver.resolve('name extra')).not.toHaveProperty('text')
  })

  it('resolves builtins and validates their arguments', () => {
    const resolver = createResolver()
    expect(resolver.resolve('age 19')).toMatchObject({ ok: true, text: '19 岁' })
    expect(resolver.resolve('age abc')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGS' }
    })
    expect(resolver.resolve('upper hello world')).toMatchObject({
      ok: true,
      text: 'HELLO WORLD'
    })
  })

  it('returns a stable error for unknown commands', () => {
    const resolver = createResolver()
    const result = resolver.resolve('unknown-command')
    expect(result).toMatchObject({
      ok: false,
      command: 'unknown-command',
      error: { code: 'COMMAND_NOT_FOUND' }
    })
    expect(result).not.toHaveProperty('text')
  })

  it('rejects empty and malformed input', () => {
    const resolver = createResolver()
    expect(resolver.resolve('   ')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGS' }
    })
    expect(resolver.resolve('greet "Alice')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGS' }
    })
  })

  it('uses an injected clock and UUID generator', () => {
    const resolver = createResolver()
    expect(resolver.resolve('date', { now: new Date(2026, 0, 2, 3, 4) })).toMatchObject({
      ok: true,
      text: '2026-01-02'
    })
    expect(resolver.resolve('uuid', { randomUUID: () => 'fixed-uuid' })).toMatchObject({
      ok: true,
      text: 'fixed-uuid'
    })
  })

  it('resolves a plugin command before a builtin', () => {
    const resolver = createResolver(
      [],
      [makePlugin('company.js', 'Company', { age: () => '插件年龄' })]
    )
    expect(resolver.resolve('age 19')).toMatchObject({
      ok: true,
      source: 'plugin',
      plugin: 'Company',
      text: '插件年龄'
    })
  })

  it('normalizes non-string and empty plugin results', () => {
    const numeric = makePlugin('numeric.js', 'Numeric', {
      bad: (() => 19) as unknown as (args: string[]) => string
    })
    const empty = makePlugin('empty.js', 'Empty', { bad: () => '' })

    expect(createResolver([], [numeric]).resolve('bad')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RESULT' }
    })
    expect(createResolver([], [empty]).resolve('bad')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RESULT' }
    })
  })

  it('normalizes plugin execution errors', () => {
    const plugin = makePlugin('error.js', 'Error', {
      fail: () => {
        throw new CommandError('PLUGIN_ERROR', '插件失败')
      }
    })
    expect(createResolver([], [plugin]).resolve('fail')).toMatchObject({
      ok: false,
      source: 'plugin',
      plugin: 'Error',
      error: { code: 'PLUGIN_ERROR', message: '插件失败' }
    })
  })

  it('returns no insertable text for plugin timeouts', () => {
    const plugin = makePlugin('slow.js', 'Slow', {
      slow: () => {
        throw new CommandError('PLUGIN_TIMEOUT', '插件执行超时')
      }
    })
    const result = createResolver([], [plugin]).resolve('slow')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PLUGIN_TIMEOUT' }
    })
    expect(result).not.toHaveProperty('text')
  })
})
