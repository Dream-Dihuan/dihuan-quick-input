const MODIFIERS = new Map<string, string>([
  ['command', 'Command'],
  ['cmd', 'Command'],
  ['commandorcontrol', 'CommandOrControl'],
  ['cmdorctrl', 'CommandOrControl'],
  ['control', 'Control'],
  ['ctrl', 'Control'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
  ['super', 'Super'],
  ['meta', 'Super']
])

const NAMED_KEYS = new Map<string, string>([
  ['space', 'Space'],
  ['tab', 'Tab'],
  ['enter', 'Enter'],
  ['return', 'Return'],
  ['escape', 'Escape'],
  ['esc', 'Escape'],
  ['backspace', 'Backspace'],
  ['delete', 'Delete'],
  ['insert', 'Insert'],
  ['home', 'Home'],
  ['end', 'End'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['printscreen', 'PrintScreen'],
  ['volumeup', 'VolumeUp'],
  ['volumedown', 'VolumeDown'],
  ['volumemute', 'VolumeMute'],
  ['medianexttrack', 'MediaNextTrack'],
  ['mediaprevioustrack', 'MediaPreviousTrack'],
  ['mediastop', 'MediaStop'],
  ['mediaplaypause', 'MediaPlayPause'],
  ['plus', 'Plus'],
  ['minus', 'Minus']
])
function normalizeKey(value: string): string | null {
  if (/^[A-Za-z0-9]$/.test(value)) {
    return value.toUpperCase()
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(value)) {
    return value.toUpperCase()
  }
  if (/^num[0-9]$/i.test(value)) {
    return `Num${value.slice(-1)}`
  }
  const named = NAMED_KEYS.get(value.toLowerCase())
  if (named) return named
  if (value.length === 1) {
    return value
  }
  return null
}

export interface AcceleratorResult {
  ok: boolean
  accelerator?: string
  message?: string
}

export function normalizeAccelerator(input: string): AcceleratorResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { ok: false, message: '快捷键不能为空' }
  }

  const parts = input.split('+').map((part) => part.trim())
  if (parts.some((part) => part.length === 0)) {
    return { ok: false, message: '快捷键格式无效' }
  }

  const keyPart = parts.at(-1)
  if (!keyPart) {
    return { ok: false, message: '快捷键缺少按键' }
  }

  const modifiers: string[] = []
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIERS.get(part.toLowerCase())
    if (!modifier) {
      return { ok: false, message: `不支持的修饰键：${part}` }
    }
    if (!modifiers.includes(modifier)) modifiers.push(modifier)
  }

  const key = normalizeKey(keyPart)
  if (!key) {
    return { ok: false, message: `不支持的按键：${keyPart}` }
  }

  return {
    ok: true,
    accelerator: [...modifiers, key].join('+')
  }
}
