export type ErrorCode =
  | 'COMMAND_NOT_FOUND'
  | 'INVALID_ARGS'
  | 'PLUGIN_ERROR'
  | 'PLUGIN_TIMEOUT'
  | 'INVALID_RESULT'
  | 'EMPTY_RESULT'
  | 'ASYNC_NOT_SUPPORTED'
  | 'EXTENSION_DISCONNECTED'
  | 'TARGET_UNKNOWN'
  | 'NO_FIELD'
  | 'INSERT_TIMEOUT'
  | 'INSERT_FAILED'
  | 'INVALID_PAYLOAD'
  | 'HOTKEY_CONFLICT'
  | 'HOTKEY_INVALID'
  | 'CONFIG_ERROR'
  | 'SERVER_ERROR'
  | 'UNAUTHORIZED'
  | 'UNKNOWN'

export interface AppErrorInfo {
  code: ErrorCode
  message: string
  details?: string
}

export function toAppError(error: unknown, fallbackCode: ErrorCode = 'UNKNOWN'): AppErrorInfo {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown }
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return {
        code: candidate.code as ErrorCode,
        message: candidate.message,
        ...(typeof candidate.details === 'string' ? { details: candidate.details } : {})
      }
    }
  }

  if (error instanceof Error) {
    return { code: fallbackCode, message: error.message }
  }

  return { code: fallbackCode, message: String(error) }
}

export function appError(code: ErrorCode, message: string, details?: string): AppErrorInfo {
  return details ? { code, message, details } : { code, message }
}
