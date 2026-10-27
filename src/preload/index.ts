import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels } from '@shared/channels'
// Keep this import type-only: @shared/ipc imports zod schemas, and sandboxed
// preload scripts cannot require arbitrary packages such as zod.
import type { DesktopApi, IpcResult, SettingsState, OverlayResult } from '@shared/ipc'
import type { AppErrorInfo } from '@shared/errors'

function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DesktopApi = {
  settings: {
    getState: () => invoke<SettingsState>(ipcChannels.settingsGetState),
    updateGeneral: (input) => invoke<SettingsState>(ipcChannels.settingsUpdateGeneral, input),
    aliases: {
      create: (input) => invoke(ipcChannels.aliasesCreate, input),
      update: (input) => invoke(ipcChannels.aliasesUpdate, input),
      remove: (input) => invoke<SettingsState>(ipcChannels.aliasesDelete, input)
    },
    plugins: {
      list: () => invoke(ipcChannels.pluginsList),
      reload: () => invoke<SettingsState>(ipcChannels.pluginsReload, {}),
      openDirectory: () => invoke(ipcChannels.pluginsOpenDirectory, {})
    },
    connection: {
      getStatus: () => invoke<SettingsState>(ipcChannels.connectionGetStatus),
      rotateToken: () => invoke<SettingsState>(ipcChannels.connectionRotateToken, {})
    },
    onboarding: {
      complete: () => invoke<SettingsState>(ipcChannels.onboardingComplete, { complete: true })
    }
  },
  overlay: {
    submit: (input) => invoke<OverlayResult>(ipcChannels.overlaySubmit, input),
    close: () => invoke(ipcChannels.overlayClose, {}),
    onOpen: (callback) => subscribe<void>(ipcChannels.eventOverlayOpen, () => callback()),
    onResult: (callback) => subscribe<OverlayResult>(ipcChannels.eventOverlayResult, callback)
  },
  events: {
    onSettingsState: (callback) =>
      subscribe<SettingsState>(ipcChannels.eventSettingsState, callback),
    onAppError: (callback) => subscribe<AppErrorInfo>(ipcChannels.eventAppError, callback)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error exposed for tests and non-isolated development only
  window.api = api
}
