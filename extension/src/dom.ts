import type { InsertMode } from '@shared/config'
import type { InsertOutcome } from './messages'

const SUPPORTED_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel'])

export function isSupportedInputType(type: string): boolean {
  return SUPPORTED_INPUT_TYPES.has(type.toLowerCase())
}

export function isEditableElement(element: Element | null): element is HTMLElement {
  if (!element || !(element instanceof HTMLElement)) return false
  if (!element.isConnected) return false
  if (!isVisible(element)) return false

  if (element instanceof HTMLInputElement) {
    return (
      isSupportedInputType(element.type) &&
      !element.disabled &&
      !element.readOnly &&
      !element.hidden
    )
  }

  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly && !element.hidden
  }

  const editable = element.getAttribute('contenteditable')
  const isContentEditable =
    element.isContentEditable ||
    editable === '' ||
    editable === 'true' ||
    editable === 'plaintext-only'
  if (isContentEditable) {
    return element.getAttribute('aria-disabled') !== 'true'
  }

  return false
}

export function isVisible(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView
  const style = view?.getComputedStyle(element) ?? getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

export function isActiveTarget(element: HTMLElement): boolean {
  const active = element.ownerDocument.activeElement
  return active === element || Boolean(active && element.contains(active))
}

export function isInsertionTarget(
  element: HTMLElement,
  pageHasFocus: boolean,
  documentHasFocus: boolean
): boolean {
  if (!isEditableElement(element)) return false
  return isActiveTarget(element) || !pageHasFocus || !documentHasFocus
}

export function insertText(element: HTMLElement, text: string, mode: InsertMode): InsertOutcome {
  if (!isEditableElement(element)) {
    return { ok: false, code: 'NO_FIELD', message: '当前字段不可编辑' }
  }
  if (!isActiveTarget(element)) {
    return { ok: false, code: 'NO_FIELD', message: '当前字段已失去焦点' }
  }

  try {
    element.focus({ preventScroll: true })
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      insertIntoValueElement(element, text, mode)
      return { ok: true }
    }
    return insertIntoContentEditable(element, text, mode)
  } catch (error) {
    return {
      ok: false,
      code: 'INSERT_FAILED',
      message: error instanceof Error ? error.message : '写入字段失败'
    }
  }
}

function insertIntoValueElement(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  mode: InsertMode
): void {
  const value = element.value
  const start = mode === 'replace' ? 0 : (element.selectionStart ?? value.length)
  const end = mode === 'replace' ? value.length : (element.selectionEnd ?? start)
  const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`

  const view = element.ownerDocument.defaultView
  const prototype =
    element instanceof HTMLTextAreaElement
      ? (view?.HTMLTextAreaElement.prototype ?? HTMLTextAreaElement.prototype)
      : (view?.HTMLInputElement.prototype ?? HTMLInputElement.prototype)
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) {
    setter.call(element, nextValue)
  } else {
    element.value = nextValue
  }

  const caret = start + text.length
  try {
    element.setSelectionRange(caret, caret)
  } catch {
    // Some input types do not support selection ranges.
  }

  dispatchInput(element, text)
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function insertIntoContentEditable(
  element: HTMLElement,
  text: string,
  mode: InsertMode
): InsertOutcome {
  const before = element.textContent ?? ''
  const doc = element.ownerDocument
  const selection = doc.getSelection()

  if (selection) {
    if (mode === 'replace') {
      const selectionRange = doc.createRange()
      selectionRange.selectNodeContents(element)
      selection.removeAllRanges()
      selection.addRange(selectionRange)
    } else if (selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
      const end = doc.createRange()
      end.selectNodeContents(element)
      end.collapse(false)
      selection.removeAllRanges()
      selection.addRange(end)
    }
  }

  let changed = false
  try {
    changed = Boolean(
      typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text)
    )
  } catch {
    // Fall through to the Range-based fallback.
  }

  if (!changed || (element.textContent ?? '') === before) {
    insertWithRange(element, text, mode)
  }

  const after = element.textContent ?? ''
  if (after === before) {
    return { ok: false, code: 'INSERT_FAILED', message: '字段内容未发生变化' }
  }

  dispatchInput(element, text)
  return { ok: true }
}

function insertWithRange(element: HTMLElement, text: string, mode: InsertMode): void {
  const doc = element.ownerDocument
  const selection = doc.getSelection()
  if (!selection) return

  let range: Range
  if (mode === 'replace') {
    range = doc.createRange()
    range.selectNodeContents(element)
  } else if (selection.rangeCount > 0 && element.contains(selection.anchorNode)) {
    range = selection.getRangeAt(0).cloneRange()
  } else {
    range = doc.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
  }

  range.deleteContents()
  const textNode = doc.createTextNode(text)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function dispatchInput(element: HTMLElement, text: string): void {
  const view = element.ownerDocument.defaultView
  const InputEventConstructor = view?.InputEvent ?? globalThis.InputEvent
  let event: Event
  try {
    event = new InputEventConstructor('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text
    })
  } catch {
    event = new Event('input', { bubbles: true, composed: true })
  }
  element.dispatchEvent(event)
}
