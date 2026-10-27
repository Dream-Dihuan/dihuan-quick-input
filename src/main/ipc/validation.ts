import type { z } from 'zod'
import { appError, type AppErrorInfo } from '@shared/errors'

export type PayloadValidation<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo }

export function validatePayload<T>(schema: z.ZodType<T>, payload: unknown): PayloadValidation<T> {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return { ok: true, data: parsed.data }
  const details = parsed.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'payload'
      return `${path}: ${issue.message}`
    })
    .join('; ')
  return {
    ok: false,
    error: appError('INVALID_PAYLOAD', '请求参数无效', details)
  }
}
