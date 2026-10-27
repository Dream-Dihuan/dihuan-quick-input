import { describe, expect, it } from 'vitest'
import {
  captureAccelerator,
  detectPlatform
} from '../../../src/renderer/src/settings/hotkey-recorder'

function event(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}
): {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
} {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers
  }
}

describe('hotkey recorder', () => {
  it('captures a macOS command shortcut', () => {
    expect(captureAccelerator(event(' ', { metaKey: true, shiftKey: true }), 'darwin')).toEqual({
      ok: true,
      accelerator: 'CommandOrControl+Shift+Space'
    })
  })

  it('captures Windows control and alt shortcuts', () => {
    expect(
      captureAccelerator(event('k', { ctrlKey: true, altKey: true, shiftKey: true }), 'win32')
    ).toEqual({ ok: true, accelerator: 'CommandOrControl+Alt+Shift+K' })
  })

  it('allows function keys without modifiers', () => {
    expect(captureAccelerator(event('F8'), 'linux')).toEqual({ ok: true, accelerator: 'F8' })
  })

  it('rejects bare characters and modifier-only presses', () => {
    expect(captureAccelerator(event('a'), 'darwin')).toMatchObject({ ok: false })
    expect(captureAccelerator(event('Shift', { shiftKey: true }), 'darwin')).toMatchObject({
      ok: false
    })
  })

  it('rejects unsupported keys and detects the platform', () => {
    expect(captureAccelerator(event('Unidentified', { metaKey: true }), 'darwin')).toMatchObject({
      ok: false
    })
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('darwin')
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win32')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
  })
})
