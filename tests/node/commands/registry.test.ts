import { describe, expect, it } from 'vitest'
import { CommandRegistry } from '../../../src/main/commands/registry'
import { makeAlias, makePlugin } from './helpers'

describe('command registry', () => {
  it('prioritizes enabled aliases over plugins and builtins', () => {
    const registry = new CommandRegistry()
    registry.update(
      [makeAlias('a1', 'age', '别名年龄')],
      [makePlugin('company.js', 'Company', { age: () => '插件年龄' })]
    )

    expect(registry.find('AGE')).toMatchObject({
      source: 'alias',
      aliasValue: '别名年龄'
    })
    expect(registry.find('age')?.source).toBe('alias')
  })

  it('prioritizes plugins over builtins when no alias exists', () => {
    const registry = new CommandRegistry()
    registry.update([], [makePlugin('company.js', 'Company', { age: () => '插件年龄' })])

    expect(registry.find('age')).toMatchObject({
      source: 'plugin',
      plugin: { name: 'Company' }
    })
  })

  it('ignores disabled aliases', () => {
    const registry = new CommandRegistry()
    registry.update([makeAlias('a1', 'age', '别名年龄', false)], [])

    expect(registry.find('age')?.source).toBe('builtin')
  })

  it('finds builtins case-insensitively', () => {
    const registry = new CommandRegistry()
    expect(registry.find('DATE')?.source).toBe('builtin')
  })

  it('reports conflicts between all sources', () => {
    const registry = new CommandRegistry()
    registry.update(
      [makeAlias('a1', 'age', '别名年龄')],
      [makePlugin('company.js', 'Company', { age: () => '插件年龄' })]
    )

    expect(registry.getConflicts()).toEqual([
      {
        command: 'age',
        sources: ['alias', 'plugin', 'builtin'],
        plugins: ['Company']
      }
    ])
  })

  it('chooses the first plugin by file name and reports plugin conflicts', () => {
    const registry = new CommandRegistry()
    registry.update(
      [],
      [
        makePlugin('b.js', 'Second', { dup: () => 'second' }),
        makePlugin('a.js', 'First', { dup: () => 'first' })
      ]
    )

    expect(registry.find('dup')?.plugin?.name).toBe('First')
    expect(registry.getConflicts()).toEqual([
      {
        command: 'dup',
        sources: ['plugin'],
        plugins: ['First', 'Second']
      }
    ])
  })

  it('lists winning commands in stable order', () => {
    const registry = new CommandRegistry()
    registry.update(
      [makeAlias('a1', 'name', '张三')],
      [makePlugin('company.js', 'Company', { company: () => '示例公司' })]
    )

    expect(registry.list()).toEqual([
      { command: 'age', source: 'builtin' },
      { command: 'company', source: 'plugin', plugin: 'Company' },
      { command: 'date', source: 'builtin' },
      { command: 'lower', source: 'builtin' },
      { command: 'name', source: 'alias' },
      { command: 'time', source: 'builtin' },
      { command: 'upper', source: 'builtin' },
      { command: 'uuid', source: 'builtin' }
    ])
  })

  it('ignores duplicate aliases after the first active one', () => {
    const registry = new CommandRegistry()
    registry.update([makeAlias('a1', 'name', '张三'), makeAlias('a2', 'NAME', '李四')], [])

    expect(registry.find('name')?.aliasValue).toBe('张三')
  })
})
