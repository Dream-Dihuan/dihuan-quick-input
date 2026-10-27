import { describe, expect, it, vi } from 'vitest'
import { HotkeyManager, type ShortcutRegistrar } from '../../../src/main/app/hotkey-manager'

function createRegistrar(options: { failFor?: string; throwFor?: string } = {}): {
  registrar: ShortcutRegistrar
  registered: Map<string, () => void>
  events: string[]
} {
  const registered = new Map<string, () => void>()
  const events: string[] = []
  const registrar: ShortcutRegistrar = {
    register: (accelerator, callback) => {
      events.push(`register:${accelerator}`)
      if (options.throwFor === accelerator) throw new Error('native failure')
      if (options.failFor === accelerator) return false
      registered.set(accelerator, callback)
      return true
    },
    unregister: (accelerator) => {
      events.push(`unregister:${accelerator}`)
      registered.delete(accelerator)
    },
    isRegistered: (accelerator) => registered.has(accelerator)
  }
  return { registrar, registered, events }
}

describe('HotkeyManager', () => {
  it('registers a normalized shortcut and invokes its callback', () => {
    const trigger = vi.fn()
    const { registrar, registered } = createRegistrar()
    const manager = new HotkeyManager(registrar, trigger)

    expect(manager.register('commandorcontrol+shift+space')).toEqual({
      ok: true,
      accelerator: 'CommandOrControl+Shift+Space'
    })
    expect(manager.isRegistered()).toBe(true)
    expect(manager.getCurrent()).toBe('CommandOrControl+Shift+Space')
    registered.get('CommandOrControl+Shift+Space')?.()
    expect(trigger).toHaveBeenCalledOnce()
  })

  it('keeps the previous shortcut when the new shortcut conflicts', () => {
    const { registrar, registered, events } = createRegistrar({
      failFor: 'CommandOrControl+Alt+Space'
    })
    const manager = new HotkeyManager(registrar, () => undefined)
    expect(manager.register('CommandOrControl+Shift+Space').ok).toBe(true)
    events.length = 0

    const result = manager.register('CommandOrControl+Alt+Space')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'HOTKEY_CONFLICT' }
    })
    expect(manager.getCurrent()).toBe('CommandOrControl+Shift+Space')
    expect(registered.has('CommandOrControl+Shift+Space')).toBe(true)
    expect(events).toEqual(['register:CommandOrControl+Alt+Space'])
  })

  it('registers the new shortcut before unregistering the previous one', () => {
    const { registrar, events } = createRegistrar()
    const manager = new HotkeyManager(registrar, () => undefined)
    manager.register('CommandOrControl+Shift+Space')
    events.length = 0

    manager.register('CommandOrControl+Alt+K')
    expect(events).toEqual([
      'register:CommandOrControl+Alt+K',
      'unregister:CommandOrControl+Shift+Space'
    ])
  })

  it('normalizes invalid and native exceptions', () => {
    const invalid = new HotkeyManager(createRegistrar().registrar, () => undefined)
    expect(invalid.register('Control+')).toMatchObject({
      ok: false,
      error: { code: 'HOTKEY_INVALID' }
    })

    const native = new HotkeyManager(
      createRegistrar({ throwFor: 'CommandOrControl+K' }).registrar,
      () => undefined
    )
    expect(native.register('CommandOrControl+K')).toMatchObject({
      ok: false,
      error: { code: 'HOTKEY_CONFLICT' }
    })
  })

  it('does not re-register the active shortcut and can unregister it', () => {
    const { registrar, events } = createRegistrar()
    const manager = new HotkeyManager(registrar, () => undefined)
    manager.register('CommandOrControl+Shift+Space')
    events.length = 0

    expect(manager.register('CommandOrControl+Shift+Space').ok).toBe(true)
    expect(events).toEqual([])

    manager.unregister()
    expect(manager.getCurrent()).toBeNull()
    expect(manager.isRegistered()).toBe(false)
    expect(events).toEqual(['unregister:CommandOrControl+Shift+Space'])
  })
})
