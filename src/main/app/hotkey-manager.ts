import { appError, type AppErrorInfo } from '@shared/errors'
import { normalizeAccelerator } from '@shared/accelerator'

export interface ShortcutRegistrar {
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
  isRegistered: (accelerator: string) => boolean
}

export interface HotkeyUpdateResult {
  ok: boolean
  accelerator?: string
  error?: AppErrorInfo
}

export class HotkeyManager {
  private current: string | null = null

  constructor(
    private readonly registrar: ShortcutRegistrar,
    private readonly onTrigger: () => void
  ) {}

  getCurrent(): string | null {
    return this.current
  }

  isRegistered(): boolean {
    return this.current !== null && this.registrar.isRegistered(this.current)
  }

  register(accelerator: string): HotkeyUpdateResult {
    const normalized = normalizeAccelerator(accelerator)
    if (!normalized.ok || !normalized.accelerator) {
      return {
        ok: false,
        error: appError('HOTKEY_INVALID', normalized.message ?? '快捷键格式无效')
      }
    }

    const next = normalized.accelerator
    if (this.current === next && this.registrar.isRegistered(next)) {
      return { ok: true, accelerator: next }
    }

    let registered: boolean
    try {
      registered = this.registrar.register(next, this.onTrigger)
    } catch (error) {
      return {
        ok: false,
        error: appError(
          'HOTKEY_CONFLICT',
          '快捷键注册失败',
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    if (!registered) {
      return {
        ok: false,
        error: appError('HOTKEY_CONFLICT', `快捷键 ${next} 已被其他应用占用`)
      }
    }

    const previous = this.current
    if (previous && previous !== next) {
      this.registrar.unregister(previous)
    }
    this.current = next
    return { ok: true, accelerator: next }
  }

  unregister(): void {
    if (this.current) {
      this.registrar.unregister(this.current)
      this.current = null
    }
  }
}
