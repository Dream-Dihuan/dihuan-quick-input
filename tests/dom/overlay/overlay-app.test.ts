import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi, IpcResult, OverlayResult } from '@shared/ipc'
import OverlayApp from '../../../src/renderer/src/overlay/OverlayApp.vue'

type OpenHandler = () => void
type ResultHandler = (result: OverlayResult) => void

let submit: ReturnType<typeof vi.fn>
let close: ReturnType<typeof vi.fn>
let openHandler: OpenHandler | undefined
let resultHandler: ResultHandler | undefined
let wrapper: VueWrapper | undefined

function installApi(): void {
  const api = {
    overlay: {
      submit,
      close,
      onOpen: (callback: OpenHandler) => {
        openHandler = callback
        return () => undefined
      },
      onResult: (callback: ResultHandler) => {
        resultHandler = callback
        return () => undefined
      }
    }
  } as unknown as DesktopApi
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
}

function mountOverlay(): VueWrapper {
  return mount(OverlayApp, { attachTo: document.body })
}

beforeEach(() => {
  submit = vi.fn(async (): Promise<IpcResult<OverlayResult>> => ({
    ok: true,
    data: { ok: true }
  }))
  close = vi.fn(async () => ({ ok: true as const, data: { closed: true as const } }))
  openHandler = undefined
  resultHandler = undefined
  installApi()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('OverlayApp', () => {
  it('submits trimmed text on Enter and clears on success', async () => {
    wrapper = mountOverlay()
    const input = wrapper.get('input')
    await input.setValue('  name  ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(submit).toHaveBeenCalledWith({ text: 'name' })
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('does not submit empty input or while composing', async () => {
    wrapper = mountOverlay()
    const input = wrapper.get('input')
    await input.trigger('keydown', { key: 'Enter' })
    expect(submit).not.toHaveBeenCalled()

    await input.setValue('name')
    await input.trigger('compositionstart')
    await input.trigger('keydown', { key: 'Enter' })
    expect(submit).not.toHaveBeenCalled()

    await input.trigger('compositionend')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(submit).toHaveBeenCalledOnce()
  })

  it('shows an insertion error and keeps the input available', async () => {
    submit.mockResolvedValueOnce({
      ok: true,
      data: { ok: false, code: 'NO_FIELD', message: '当前页面没有可插入的字段' }
    })
    wrapper = mountOverlay()
    const input = wrapper.get('input')
    await input.setValue('name')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.get('.overlay-error').text()).toBe('当前页面没有可插入的字段')
    expect((input.element as HTMLInputElement).disabled).toBe(false)
  })

  it('shows IPC, command and push errors', async () => {
    submit.mockResolvedValueOnce({
      ok: false,
      error: { code: 'COMMAND_NOT_FOUND', message: '未找到命令：missing' }
    })
    wrapper = mountOverlay()
    const input = wrapper.get('input')
    await input.setValue('missing')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.get('.overlay-error').text()).toBe('未找到命令：missing')

    resultHandler?.({ ok: false, code: 'EXTENSION_DISCONNECTED', message: '扩展已断开' })
    await flushPromises()
    expect(wrapper.get('.overlay-error').text()).toBe('扩展已断开')
  })

  it('closes on Escape and resets when the main process opens it', async () => {
    wrapper = mountOverlay()
    const input = wrapper.get('input')
    await input.setValue('name')
    await input.trigger('keydown', { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()

    openHandler?.()
    await flushPromises()
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('shows a failure message when submit throws', async () => {
    submit.mockRejectedValueOnce(new Error('IPC unavailable'))
    wrapper = mountOverlay()
    await wrapper.get('input').setValue('name')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.get('.overlay-error').text()).toBe('IPC unavailable')
  })
})
