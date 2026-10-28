import { ipcMain, shell } from 'electron'
import type { z } from 'zod'
import {
  aliasCreateSchema,
  aliasDeleteSchema,
  aliasUpdateSchema,
  folderCreateSchema,
  folderDeleteSchema,
  folderUpdateSchema,
  completeOnboardingSchema,
  emptyPayloadSchema,
  ipcChannels,
  overlaySubmitSchema,
  updateGeneralSchema,
  type IpcResult
} from '@shared/ipc'
import { toAppError } from '@shared/errors'
import type { WindowManager } from '../app/windows'
import type { AppService } from '../services/app-service'
import { validatePayload } from './validation'

type Scope = 'settings' | 'overlay'

export interface IpcContext {
  service: AppService
  windows: WindowManager
}

export function registerIpcHandlers(context: IpcContext): () => void {
  const channels: string[] = []

  const register = <TInput, TOutput>(
    channel: string,
    schema: z.ZodType<TInput> | null,
    scope: Scope,
    handler: (input: TInput) => TOutput | Promise<TOutput>
  ): void => {
    channels.push(channel)
    ipcMain.handle(channel, async (event, payload: unknown): Promise<IpcResult<TOutput>> => {
      const allowed =
        scope === 'settings'
          ? context.windows.isSettingsSender(event.sender.id)
          : context.windows.isOverlaySender(event.sender.id)
      if (!allowed) {
        return {
          ok: false,
          error: { code: 'UNAUTHORIZED', message: '无权访问该接口' }
        }
      }

      let input = payload as TInput
      if (schema) {
        const validation = validatePayload(schema, payload)
        if (!validation.ok) return { ok: false, error: validation.error }
        input = validation.data
      }

      try {
        return { ok: true, data: await handler(input) }
      } catch (error) {
        return { ok: false, error: toAppError(error) }
      }
    })
  }

  register(ipcChannels.settingsGetState, null, 'settings', () => context.service.getState())
  register(ipcChannels.settingsUpdateGeneral, updateGeneralSchema, 'settings', (input) =>
    context.service.updateGeneral(input)
  )
  register(ipcChannels.aliasesCreate, aliasCreateSchema, 'settings', (input) =>
    context.service.createAlias(input)
  )
  register(ipcChannels.aliasesUpdate, aliasUpdateSchema, 'settings', (input) =>
    context.service.updateAlias(input)
  )
  register(ipcChannels.aliasesDelete, aliasDeleteSchema, 'settings', (input) =>
    context.service.deleteAlias(input.id)
  )
  register(ipcChannels.foldersCreate, folderCreateSchema, 'settings', (input) =>
    context.service.createFolder(input)
  )
  register(ipcChannels.foldersUpdate, folderUpdateSchema, 'settings', (input) =>
    context.service.updateFolder(input)
  )
  register(ipcChannels.foldersDelete, folderDeleteSchema, 'settings', (input) =>
    context.service.deleteFolder(input.id, input.moveContents ?? false)
  )
  register(
    ipcChannels.pluginsList,
    emptyPayloadSchema,
    'settings',
    () => context.service.getState().plugins
  )
  register(ipcChannels.pluginsReload, emptyPayloadSchema, 'settings', () =>
    context.service.reloadPlugins()
  )
  register(ipcChannels.pluginsOpenDirectory, emptyPayloadSchema, 'settings', async () => {
    const path = context.service.getState().pluginDirectory
    const error = await shell.openPath(path)
    if (error) {
      return Promise.reject(new Error(error))
    }
    return { path }
  })
  register(ipcChannels.connectionGetStatus, emptyPayloadSchema, 'settings', () =>
    context.service.getState()
  )
  register(ipcChannels.connectionRotateToken, emptyPayloadSchema, 'settings', () =>
    context.service.rotateToken()
  )
  register(ipcChannels.onboardingComplete, completeOnboardingSchema, 'settings', () =>
    context.service.completeOnboarding()
  )
  register(ipcChannels.overlaySubmit, overlaySubmitSchema, 'overlay', async (input) => {
    const result = await context.service.submitOverlay(input.text)
    context.windows.sendOverlayResult(result)
    return result
  })
  register(ipcChannels.overlayClose, emptyPayloadSchema, 'overlay', () => {
    context.windows.hideOverlay()
    return { closed: true as const }
  })

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
