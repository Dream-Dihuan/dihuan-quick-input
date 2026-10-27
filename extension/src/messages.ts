import type { InsertMode } from '@shared/config'

export const runtimeMessage = {
  pageFocus: 'qia:page-focus',
  insertText: 'qia:insert-text',
  focusStateRequest: 'qia:focus-state-request',
  focusState: 'qia:focus-state',
  getStatus: 'qia:get-status',
  reconnect: 'qia:reconnect',
  tokenUpdated: 'qia:token-updated'
} as const

export interface InsertTextRequest {
  type: typeof runtimeMessage.insertText
  id: string
  text: string
  mode: InsertMode
}

export interface InsertOutcome {
  ok: boolean
  code?: string
  message?: string
}

export interface PageFocusRequest {
  type: typeof runtimeMessage.pageFocus
  ts: number
}

export interface FocusStateRequest {
  type: typeof runtimeMessage.focusStateRequest
}

export interface FocusStateResponse {
  type: typeof runtimeMessage.focusState
  hasFocus: boolean
  lastFocusAt?: number
}

export interface GetStatusRequest {
  type: typeof runtimeMessage.getStatus
}

export interface ReconnectRequest {
  type: typeof runtimeMessage.reconnect
}

export interface TokenUpdatedRequest {
  type: typeof runtimeMessage.tokenUpdated
}
