import type { InsertMode } from '@shared/config'
import type { OverlayResult } from '@shared/ipc'
import type { CommandResolver } from '../commands/resolver'
import type { ConnectionError, InsertSuccess } from '../connection/connection-server'

export interface OverlaySubmitDependencies {
  resolver: CommandResolver
  getInsertMode: () => InsertMode
  insert: (text: string, mode: InsertMode) => Promise<InsertSuccess>
  onSuccess?: () => void
}

export class OverlaySubmitService {
  constructor(private readonly dependencies: OverlaySubmitDependencies) {}

  async submit(rawText: string): Promise<OverlayResult> {
    const resolved = this.dependencies.resolver.resolve(rawText)
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.error.code,
        message: resolved.error.message
      }
    }

    try {
      await this.dependencies.insert(resolved.text, this.dependencies.getInsertMode())
      this.dependencies.onSuccess?.()
      return { ok: true }
    } catch (error) {
      if (isConnectionError(error)) {
        return { ok: false, code: error.code, message: error.message }
      }
      return {
        ok: false,
        code: 'INSERT_FAILED',
        message: error instanceof Error ? error.message : '插入失败'
      }
    }
  }
}

function isConnectionError(error: unknown): error is ConnectionError {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}
