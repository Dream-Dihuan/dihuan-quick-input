import { describe, expect, it } from 'vitest'
import {
  aliasCreateSchema,
  aliasDeleteSchema,
  aliasUpdateSchema,
  completeOnboardingSchema,
  emptyPayloadSchema,
  folderCreateSchema,
  folderDeleteSchema,
  folderUpdateSchema,
  overlaySubmitSchema,
  updateGeneralSchema
} from '@shared/ipc'
import { validatePayload } from '../../../src/main/ipc/validation'

describe('IPC payload validation', () => {
  it('accepts valid general, alias and overlay payloads', () => {
    expect(
      validatePayload(updateGeneralSchema, {
        hotkey: 'CommandOrControl+Shift+Space',
        insertMode: 'caret',
        launchAtLogin: true
      }).ok
    ).toBe(true)
    expect(validatePayload(aliasCreateSchema, { command: 'name', value: '张三' }).ok).toBe(true)
    expect(validatePayload(aliasUpdateSchema, { id: 'a1', enabled: false }).ok).toBe(true)
    expect(validatePayload(aliasDeleteSchema, { id: 'a1' }).ok).toBe(true)
    expect(validatePayload(overlaySubmitSchema, { text: 'name' }).ok).toBe(true)
    expect(validatePayload(completeOnboardingSchema, { complete: true }).ok).toBe(true)
    expect(validatePayload(folderCreateSchema, { name: 'Work' }).ok).toBe(true)
    expect(validatePayload(folderCreateSchema, { name: 'Work', parentId: null }).ok).toBe(true)
    expect(validatePayload(folderUpdateSchema, { id: 'f1', name: 'Renamed' }).ok).toBe(true)
    expect(validatePayload(folderDeleteSchema, { id: 'f1', moveContents: true }).ok).toBe(true)
  })

  it('validates folder payloads strictly', () => {
    expect(validatePayload(folderCreateSchema, { name: '   ' }).ok).toBe(false)
    expect(validatePayload(folderCreateSchema, { name: 'ok', parentId: 7 }).ok).toBe(false)
    expect(validatePayload(folderUpdateSchema, { id: 'f1', name: ' ' }).ok).toBe(false)
    expect(validatePayload(folderDeleteSchema, { id: 'f1', moveContents: 'yes' }).ok).toBe(false)
    expect(validatePayload(folderDeleteSchema, {}).ok).toBe(false)
  })

  it('rejects empty update payloads and malformed commands', () => {
    const empty = validatePayload(updateGeneralSchema, {})
    expect(empty.ok).toBe(false)
    if (!empty.ok) {
      expect(empty.error.code).toBe('INVALID_PAYLOAD')
      expect(empty.error.details).toContain('至少需要修改一个字段')
    }

    const malformed = validatePayload(aliasCreateSchema, {
      command: 'name extra',
      value: '   '
    })
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) {
      expect(malformed.error.code).toBe('INVALID_PAYLOAD')
      expect(malformed.error.details).toContain('command')
      expect(malformed.error.details).toContain('value')
    }
  })

  it('rejects wrong types, missing required fields and oversized text', () => {
    expect(validatePayload(aliasDeleteSchema, { id: 7 }).ok).toBe(false)
    expect(validatePayload(overlaySubmitSchema, { text: 'x'.repeat(2_001) }).ok).toBe(false)
    expect(validatePayload(completeOnboardingSchema, { complete: false }).ok).toBe(false)
    expect(validatePayload(emptyPayloadSchema, { extra: true }).ok).toBe(false)
    expect(validatePayload(updateGeneralSchema, { launchAtLogin: 'yes' }).ok).toBe(false)
  })
})
