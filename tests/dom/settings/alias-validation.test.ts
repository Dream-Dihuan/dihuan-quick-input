import { describe, expect, it } from 'vitest'
import {
  hasAliasErrors,
  validateAliasDraft
} from '../../../src/renderer/src/settings/alias-validation'

const aliases = [
  { id: 'a1', command: 'name', value: '张三', enabled: true },
  { id: 'a2', command: 'age', value: '19', enabled: true }
]

describe('alias form validation', () => {
  it('accepts a valid new mapping', () => {
    expect(validateAliasDraft({ command: 'city', value: '上海' }, aliases)).toEqual({})
  })

  it('rejects empty, whitespace and oversized commands', () => {
    expect(validateAliasDraft({ command: '', value: 'x' }, aliases).command).toContain('不能为空')
    expect(validateAliasDraft({ command: 'a b', value: 'x' }, aliases).command).toContain('空白')
    expect(validateAliasDraft({ command: ' a', value: 'x' }, aliases).command).toContain('空白')
    expect(validateAliasDraft({ command: 'a'.repeat(65), value: 'x' }, aliases).command).toContain(
      '64'
    )
  })

  it('rejects duplicate commands case-insensitively but excludes the edited item', () => {
    expect(validateAliasDraft({ command: 'NAME', value: 'x' }, aliases).command).toContain('已存在')
    expect(validateAliasDraft({ command: 'name', value: 'x' }, aliases, 'a1')).toEqual({})
    expect(validateAliasDraft({ command: 'name', value: 'x' }, aliases, 'a2').command).toContain(
      '已存在'
    )
  })

  it('rejects blank and oversized values', () => {
    expect(validateAliasDraft({ command: 'city', value: '   ' }, aliases).value).toContain(
      '不能为空'
    )
    expect(
      validateAliasDraft({ command: 'city', value: 'x'.repeat(10_001) }, aliases).value
    ).toContain('10,000')
    expect(hasAliasErrors({ command: 'bad' })).toBe(true)
    expect(hasAliasErrors({})).toBe(false)
  })
})
