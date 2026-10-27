import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  insertText,
  isActiveTarget,
  isEditableElement,
  isInsertionTarget,
  isSupportedInputType
} from '../../../extension/src/dom'

function visibleRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 120,
    height: 30,
    top: 0,
    right: 120,
    bottom: 30,
    left: 0,
    toJSON: () => ({})
  } as DOMRect
}

function attach<T extends HTMLElement>(element: T): T {
  document.body.appendChild(element)
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: visibleRect
  })
  element.focus()
  return element
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('DOM editable detection', () => {
  it('supports the documented text-like input types only', () => {
    for (const type of ['text', 'search', 'email', 'url', 'tel']) {
      expect(isSupportedInputType(type)).toBe(true)
    }
    for (const type of ['password', 'number', 'file', 'checkbox', 'hidden']) {
      expect(isSupportedInputType(type)).toBe(false)
    }

    const input = attach(document.createElement('input'))
    input.type = 'text'
    const textarea = attach(document.createElement('textarea'))
    const password = attach(document.createElement('input'))
    password.type = 'password'
    const number = attach(document.createElement('input'))
    number.type = 'number'
    const checkbox = attach(document.createElement('input'))
    checkbox.type = 'checkbox'

    expect(isEditableElement(input)).toBe(true)
    expect(isEditableElement(textarea)).toBe(true)
    expect(isEditableElement(password)).toBe(false)
    expect(isEditableElement(number)).toBe(false)
    expect(isEditableElement(checkbox)).toBe(false)
  })

  it('rejects disabled, readonly, hidden, zero-size and detached fields', () => {
    const disabled = attach(document.createElement('input'))
    disabled.disabled = true
    expect(isEditableElement(disabled)).toBe(false)

    const readonly = attach(document.createElement('input'))
    readonly.readOnly = true
    expect(isEditableElement(readonly)).toBe(false)

    const hidden = attach(document.createElement('input'))
    hidden.style.display = 'none'
    expect(isEditableElement(hidden)).toBe(false)

    const zero = document.createElement('input')
    document.body.appendChild(zero)
    zero.focus()
    expect(isEditableElement(zero)).toBe(false)

    const detached = document.createElement('input')
    expect(isEditableElement(detached)).toBe(false)
  })

  it('detects contenteditable and active targets', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.tabIndex = 0
    editor.textContent = 'hello'
    attach(editor)
    expect(isEditableElement(editor)).toBe(true)
    expect(isActiveTarget(editor)).toBe(true)

    const input = attach(document.createElement('input'))
    expect(isActiveTarget(editor)).toBe(false)
    expect(isActiveTarget(input)).toBe(true)
  })

  it('keeps the last editable target when the browser loses focus', () => {
    const input = attach(document.createElement('input'))
    input.blur()

    expect(isInsertionTarget(input, true, true)).toBe(false)
    expect(isInsertionTarget(input, false, true)).toBe(true)
    expect(isInsertionTarget(input, true, false)).toBe(true)

    const disabled = document.createElement('input')
    disabled.disabled = true
    document.body.appendChild(disabled)
    expect(isInsertionTarget(disabled, false, false)).toBe(false)
  })
})

describe('native value insertion', () => {
  it('inserts at the caret and dispatches input and change', () => {
    const input = attach(document.createElement('input'))
    input.value = 'Hello world'
    input.setSelectionRange(6, 11)
    const inputEvent = vi.fn()
    const changeEvent = vi.fn()
    input.addEventListener('input', inputEvent)
    input.addEventListener('change', changeEvent)

    expect(insertText(input, 'there', 'caret')).toEqual({ ok: true })
    expect(input.value).toBe('Hello there')
    expect(input.selectionStart).toBe(11)
    expect(inputEvent).toHaveBeenCalledOnce()
    expect(changeEvent).toHaveBeenCalledOnce()
  })

  it('replaces the whole value in replace mode', () => {
    const input = attach(document.createElement('input'))
    input.value = 'old value'
    input.setSelectionRange(2, 4)
    expect(insertText(input, 'new', 'replace')).toEqual({ ok: true })
    expect(input.value).toBe('new')
    expect(input.selectionStart).toBe(3)
  })

  it('handles textarea and rejects unfocused or unsupported fields', () => {
    const textarea = attach(document.createElement('textarea'))
    textarea.value = 'abc'
    textarea.setSelectionRange(3, 3)
    expect(insertText(textarea, 'd', 'caret')).toEqual({ ok: true })
    expect(textarea.value).toBe('abcd')

    const unfocused = attach(document.createElement('input'))
    unfocused.blur()
    expect(insertText(unfocused, 'x', 'caret')).toMatchObject({
      ok: false,
      code: 'NO_FIELD'
    })

    const checkbox = attach(document.createElement('input'))
    checkbox.type = 'checkbox'
    expect(insertText(checkbox, 'x', 'caret')).toMatchObject({ ok: false, code: 'NO_FIELD' })
  })
})

describe('contenteditable insertion', () => {
  function editorWithText(text: string): HTMLDivElement {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.tabIndex = 0
    editor.textContent = text
    attach(editor)
    return editor
  }

  it('uses execCommand first and reports a text change', () => {
    const editor = editorWithText('hello')
    const execCommand = vi.fn(() => {
      editor.textContent = 'hello world'
      return true
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    })
    const inputEvent = vi.fn()
    editor.addEventListener('input', inputEvent)

    expect(insertText(editor, ' world', 'caret')).toEqual({ ok: true })
    expect(execCommand).toHaveBeenCalledWith('insertText', false, ' world')
    expect(editor.textContent).toBe('hello world')
    expect(inputEvent).toHaveBeenCalledOnce()
  })

  it('falls back to a Range when execCommand is unavailable', () => {
    const editor = editorWithText('hello')
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: undefined
    })

    const selection = document.getSelection()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(insertText(editor, ' world', 'caret')).toEqual({ ok: true })
    expect(editor.textContent).toBe('hello world')
  })

  it('returns INSERT_FAILED when the text did not change', () => {
    const editor = editorWithText('same')
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true)
    })

    expect(insertText(editor, 'same', 'replace')).toEqual({
      ok: false,
      code: 'INSERT_FAILED',
      message: '字段内容未发生变化'
    })
  })
})
