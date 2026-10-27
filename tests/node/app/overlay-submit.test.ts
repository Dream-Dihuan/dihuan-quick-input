import { describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '@shared/config'
import { CommandRegistry } from '../../../src/main/commands/registry'
import { CommandResolver } from '../../../src/main/commands/resolver'
import { ConnectionError } from '../../../src/main/connection/connection-server'
import { OverlaySubmitService } from '../../../src/main/services/overlay-submit'

function createService(
  options: {
    insert?: (text: string, mode: string) => Promise<{ connectionId: string; browserName: string }>
    mode?: 'caret' | 'replace'
    onSuccess?: () => void
  } = {}
): {
  service: OverlaySubmitService
  insert: ReturnType<typeof vi.fn>
  onSuccess: ReturnType<typeof vi.fn>
} {
  const registry = new CommandRegistry()
  const config = createDefaultConfig('a'.repeat(32))
  registry.update(
    [
      {
        id: 'a1',
        command: 'name',
        value: '张三',
        enabled: true
      }
    ],
    []
  )
  const insert = vi.fn(
    options.insert ?? (async () => ({ connectionId: 'c1', browserName: 'Chrome' }))
  )
  const onSuccess = vi.fn(options.onSuccess)
  const service = new OverlaySubmitService({
    resolver: new CommandResolver(registry),
    getInsertMode: () => options.mode ?? config.insertMode,
    insert: insert as never,
    onSuccess
  })
  return { service, insert, onSuccess }
}

describe('OverlaySubmitService', () => {
  it('resolves a command, inserts text with the configured mode and calls success once', async () => {
    const { service, insert, onSuccess } = createService({ mode: 'replace' })
    await expect(service.submit('name')).resolves.toEqual({ ok: true })
    expect(insert).toHaveBeenCalledWith('张三', 'replace')
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('returns a command error without touching the extension', async () => {
    const { service, insert, onSuccess } = createService()
    await expect(service.submit('missing')).resolves.toMatchObject({
      ok: false,
      code: 'COMMAND_NOT_FOUND'
    })
    expect(insert).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('returns a connection error and keeps the overlay open', async () => {
    const { service, insert, onSuccess } = createService({
      insert: async () => {
        throw new ConnectionError('EXTENSION_DISCONNECTED', '浏览器扩展已断开')
      }
    })
    await expect(service.submit('name')).resolves.toEqual({
      ok: false,
      code: 'EXTENSION_DISCONNECTED',
      message: '浏览器扩展已断开'
    })
    expect(insert).toHaveBeenCalledOnce()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('normalizes unknown insertion failures', async () => {
    const { service, onSuccess } = createService({
      insert: async () => {
        throw new Error('boom')
      }
    })
    await expect(service.submit('name')).resolves.toEqual({
      ok: false,
      code: 'INSERT_FAILED',
      message: 'boom'
    })
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
