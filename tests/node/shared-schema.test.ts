import { describe, expect, it } from 'vitest'
import { appConfigSchema, createDefaultConfig } from '@shared/config'
import { clientHelloSchema, serverInsertSchema } from '@shared/protocol'

describe('shared schemas', () => {
  it('accepts a default config', () => {
    const config = createDefaultConfig('a'.repeat(32))
    expect(appConfigSchema.parse(config)).toEqual(config)
  })

  it('validates protocol messages', () => {
    expect(
      clientHelloSchema.safeParse({
        v: 1,
        type: 'hello',
        token: 'token',
        extensionVersion: '0.1.0',
        browserName: 'Chrome'
      }).success
    ).toBe(true)

    expect(
      serverInsertSchema.safeParse({
        v: 1,
        type: 'insert',
        id: 'request-1',
        text: '张三',
        mode: 'caret'
      }).success
    ).toBe(true)
  })
})
