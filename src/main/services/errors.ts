import type { ErrorCode } from '@shared/errors'

export class AppErrorException extends Error {
  readonly code: ErrorCode
  readonly details?: string

  constructor(code: ErrorCode, message: string, details?: string) {
    super(message)
    this.name = 'AppErrorException'
    this.code = code
    this.details = details
  }
}
