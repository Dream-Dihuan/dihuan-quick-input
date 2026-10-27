import { z } from 'zod'
import {
  aliasCommandSchema,
  aliasSchema,
  aliasValueSchema,
  appConfigSchema,
  insertModeSchema,
  type Alias,
  type AppConfig
} from './config'
import type { AppErrorInfo, ErrorCode } from './errors'

export type CommandSource = 'alias' | 'plugin' | 'builtin'

export interface CommandSummary {
  command: string
  source: CommandSource
  plugin?: string
}

export interface CommandConflict {
  command: string
  sources: CommandSource[]
  plugins?: string[]
}

export interface PluginInfo {
  file: string
  name: string
  commands: string[]
  error?: string
}

export interface ConnectionInfo {
  id: string
  browserName: string
  extensionVersion: string
  connectedAt: number
  lastPageFocusAt: number | null
}

export interface RuntimeStatus {
  port: number | null
  hotkey: string
  hotkeyRegistered: boolean
  errors: AppErrorInfo[]
  configRecovered: boolean
  configStatus: 'ok' | 'created' | 'partial' | 'recovered'
  configWarnings: string[]
  configBackupPath?: string
}

export interface SettingsState {
  config: AppConfig
  plugins: PluginInfo[]
  pluginDirectory: string
  commands: CommandSummary[]
  conflicts: CommandConflict[]
  connections: ConnectionInfo[]
  runtime: RuntimeStatus
}

export interface OverlayResult {
  ok: boolean
  code?: ErrorCode
  message?: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo }

export const emptyPayloadSchema = z.object({}).strict()

export const updateGeneralSchema = z
  .object({
    hotkey: z.string().min(1).max(100).optional(),
    insertMode: insertModeSchema.optional(),
    launchAtLogin: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少需要修改一个字段' })
export type UpdateGeneralInput = z.infer<typeof updateGeneralSchema>

export const aliasCreateSchema = z.object({
  command: aliasCommandSchema,
  value: aliasValueSchema,
  enabled: z.boolean().optional()
})
export type AliasCreateInput = z.infer<typeof aliasCreateSchema>

export const aliasUpdateSchema = z.object({
  id: z.string().min(1),
  command: aliasCommandSchema.optional(),
  value: aliasValueSchema.optional(),
  enabled: z.boolean().optional()
})
export type AliasUpdateInput = z.infer<typeof aliasUpdateSchema>

export const aliasDeleteSchema = z.object({
  id: z.string().min(1)
})
export type AliasDeleteInput = z.infer<typeof aliasDeleteSchema>

export const overlaySubmitSchema = z.object({
  text: z.string().max(2_000)
})
export type OverlaySubmitInput = z.infer<typeof overlaySubmitSchema>

export const completeOnboardingSchema = z.object({
  complete: z.literal(true)
})

export { ipcChannels } from './channels'

export interface SettingsApi {
  getState(): Promise<IpcResult<SettingsState>>
  updateGeneral(input: UpdateGeneralInput): Promise<IpcResult<SettingsState>>
  aliases: {
    create(input: AliasCreateInput): Promise<IpcResult<Alias>>
    update(input: AliasUpdateInput): Promise<IpcResult<Alias>>
    remove(input: AliasDeleteInput): Promise<IpcResult<SettingsState>>
  }
  plugins: {
    list(): Promise<IpcResult<PluginInfo[]>>
    reload(): Promise<IpcResult<SettingsState>>
    openDirectory(): Promise<IpcResult<{ path: string }>>
  }
  connection: {
    getStatus(): Promise<IpcResult<SettingsState>>
    rotateToken(): Promise<IpcResult<SettingsState>>
  }
  onboarding: {
    complete(): Promise<IpcResult<SettingsState>>
  }
}

export interface OverlayApi {
  submit(input: OverlaySubmitInput): Promise<IpcResult<OverlayResult>>
  close(): Promise<IpcResult<{ closed: true }>>
  onOpen(callback: () => void): () => void
  onResult(callback: (result: OverlayResult) => void): () => void
}

export interface EventApi {
  onSettingsState(callback: (state: SettingsState) => void): () => void
  onAppError(callback: (error: AppErrorInfo) => void): () => void
}

export interface DesktopApi {
  settings: SettingsApi
  overlay: OverlayApi
  events: EventApi
}

export const aliasSchemaForIpc = aliasSchema
export const appConfigSchemaForIpc = appConfigSchema
