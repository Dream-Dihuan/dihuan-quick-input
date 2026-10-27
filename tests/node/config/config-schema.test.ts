import { describe, expect, it } from 'vitest'
import { appConfigSchema, createDefaultConfig } from '@shared/config'
import { generatePairingToken } from '../../../src/main/config/token'

describe('config schema and token generation', () => {
  it('creates safe defaults', () => {
    const token = generatePairingToken()
    const config = createDefaultConfig(token)
    expect(config).toMatchObject({
      version: 1,
      onboardingComplete: false,
      hotkey: 'CommandOrControl+Shift+Space',
      insertMode: 'caret',
      launchAtLogin: false,
      server: { token },
      aliases: [],
      plugins: { enabled: true }
    })
    expect(appConfigSchema.safeParse(config).success).toBe(true)
  })

  it('generates unique URL-safe 32-byte tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generatePairingToken()))
    expect(tokens.size).toBe(200)
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  it('rejects whitespace in alias names and blank values', () => {
    const config = createDefaultConfig(generatePairingToken())
    config.aliases = [
      { id: 'a1', command: 'first name', value: '张三', enabled: true },
      { id: 'a2', command: 'name', value: '   ', enabled: true }
    ]
    expect(appConfigSchema.safeParse(config).success).toBe(false)
  })

  it('rejects case-insensitive duplicate aliases', () => {
    const config = createDefaultConfig(generatePairingToken())
    config.aliases = [
      { id: 'a1', command: 'Name', value: '张三', enabled: true },
      { id: 'a2', command: 'name', value: '李四', enabled: true }
    ]
    const result = appConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('不能重复')
    }
  })
})
