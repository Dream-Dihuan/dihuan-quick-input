import { insertText, isActiveTarget, isEditableElement, isInsertionTarget } from './dom'
import {
  runtimeMessage,
  type FocusStateRequest,
  type InsertTextRequest,
  type InsertOutcome,
  type PageFocusRequest
} from './messages'

let lastTarget: HTMLElement | null = null
let lastFocusAt = 0
let pageHasFocus = document.hasFocus()

function editableTarget(): HTMLElement | null {
  if (
    !lastTarget ||
    !lastTarget.isConnected ||
    !isEditableElement(lastTarget) ||
    !isInsertionTarget(lastTarget, pageHasFocus, document.hasFocus())
  ) {
    return null
  }
  return lastTarget
}

function reportFocus(): void {
  const target = editableTarget()
  if (!target) return
  const message: PageFocusRequest = {
    type: runtimeMessage.pageFocus,
    ts: lastFocusAt || Date.now()
  }
  try {
    void chrome.runtime.sendMessage(message).catch(() => undefined)
  } catch {
    // The extension context can be invalidated while a page stays open.
  }
}

function remember(target: HTMLElement): void {
  lastTarget = target
  lastFocusAt = Date.now()
  reportFocus()
}

function resolveEditableTarget(candidate: Element | null): HTMLElement | null {
  if (!candidate) return null
  if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
    return isEditableElement(candidate) ? candidate : null
  }
  if (!(candidate instanceof HTMLElement)) return null
  const host = candidate.closest(
    '[contenteditable]:not([contenteditable="false"])'
  ) as HTMLElement | null
  return host && isEditableElement(host) ? host : null
}

function handleFocusIn(event: FocusEvent): void {
  const path = event.composedPath()
  const candidate = (path[0] ?? event.target) as Element | null
  const target = resolveEditableTarget(candidate)
  if (target) {
    remember(target)
  } else {
    lastTarget = null
    lastFocusAt = 0
  }
}

function handleMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: InsertOutcome | { ok: boolean }) => void
): boolean {
  if (!message || typeof message !== 'object') return false
  const type = (message as { type?: unknown }).type

  if (type === runtimeMessage.insertText) {
    const request = message as InsertTextRequest
    const target = editableTarget()
    if (!target) {
      sendResponse({ ok: false, code: 'NO_FIELD', message: '当前页面没有聚焦的可编辑字段' })
      return false
    }
    target.focus({ preventScroll: true })
    sendResponse(insertText(target, request.text, request.mode))
    return false
  }

  if (type === runtimeMessage.focusStateRequest) {
    const request = message as FocusStateRequest
    void request
    if (editableTarget()) reportFocus()
    sendResponse({ ok: true })
    return false
  }

  return false
}

document.addEventListener('focusin', handleFocusIn, true)
document.addEventListener(
  'focusout',
  () => {
    const target = lastTarget
    if (!target) return
    window.setTimeout(() => {
      if (lastTarget !== target) return
      if (pageHasFocus && document.hasFocus() && !isActiveTarget(target)) {
        lastTarget = null
        lastFocusAt = 0
      }
    }, 0)
  },
  true
)
window.addEventListener(
  'focus',
  () => {
    pageHasFocus = true
    reportFocus()
  },
  true
)
window.addEventListener(
  'blur',
  () => {
    pageHasFocus = false
  },
  true
)
window.addEventListener(
  'pageshow',
  () => {
    pageHasFocus = document.hasFocus()
    reportFocus()
  },
  true
)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    pageHasFocus = document.hasFocus()
    reportFocus()
  }
})
window.addEventListener(
  'pagehide',
  () => {
    lastTarget = null
    lastFocusAt = 0
    pageHasFocus = false
  },
  true
)

chrome.runtime.onMessage.addListener(handleMessage)

const initial = document.activeElement
if (initial instanceof HTMLElement && isEditableElement(initial)) {
  remember(initial)
}
