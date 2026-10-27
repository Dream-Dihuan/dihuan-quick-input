export type Platform = 'darwin' | 'win32' | 'linux'

export interface KeyboardEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type AcceleratorCaptureResult =
  { ok: true; accelerator: string } | { ok: false; message: string }

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Enter: 'Enter',
  '+': 'Plus',
  '-': 'Minus'
}

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift', 'CapsLock'])

export function detectPlatform(userAgent = navigator.userAgent): Platform {
  if (/Mac|iPhone|iPad/i.test(userAgent)) return 'darwin'
  if (/Windows/i.test(userAgent)) return 'win32'
  return 'linux'
}

export function captureAccelerator(
  event: KeyboardEventLike,
  platform: Platform
): AcceleratorCaptureResult {
  if (MODIFIER_KEYS.has(event.key)) {
    return { ok: false, message: '请继续按下一个非修饰键' }
  }

  const key = normalizeKey(event.key)
  if (!key) {
    return { ok: false, message: '该按键无法用于全局快捷键' }
  }

  const modifiers: string[] = []
  if (platform === 'darwin') {
    if (event.metaKey) modifiers.push('CommandOrControl')
    if (event.ctrlKey) modifiers.push('Control')
  } else {
    if (event.ctrlKey) modifiers.push('CommandOrControl')
    if (event.metaKey) modifiers.push('Super')
  }
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')

  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
  if (modifiers.length === 0 && !functionKey) {
    return { ok: false, message: '请至少使用一个修饰键（F1–F24 除外）' }
  }

  return { ok: true, accelerator: [...modifiers, key].join('+') }
}

function normalizeKey(key: string): string | null {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase()
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase()
  if (/^Numpad[0-9]$/i.test(key)) return `Num${key.slice(-1)}`
  if (/^Num[0-9]$/i.test(key)) return `Num${key.slice(-1)}`
  if (NAMED_KEYS[key]) return NAMED_KEYS[key]
  if (key.length === 1) return key
  return null
}
