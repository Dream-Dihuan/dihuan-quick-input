import { app, dialog, globalShortcut } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { CommandRegistry } from './commands/registry'
import { PluginHost } from './commands/plugin-host'
import { ConnectionServer } from './connection/connection-server'
import { initializeAppData, type InitializedAppData } from './config/initialize'
import { WindowManager } from './app/windows'
import { HotkeyManager } from './app/hotkey-manager'
import { AppTray } from './app/tray'
import { getLaunchAtLogin, isHiddenStart, setLaunchAtLogin } from './app/login-item'
import { AppService } from './services/app-service'
import { registerIpcHandlers } from './ipc/register-handlers'
import { ipcChannels } from '@shared/ipc'

let windows: WindowManager | null = null
let appService: AppService | null = null
let tray: AppTray | null = null
let disposeIpc: (() => void) | null = null
let shutdownStarted = false
let shutdownFinished = false

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windows?.showSettings()
  })
  app.whenReady().then(bootstrap).catch(handleFatalStartup)
}

async function bootstrap(): Promise<void> {
  electronApp.setAppUserModelId('com.dihuan.quickinput')
  const startHidden = isHiddenStart()

  let data: InitializedAppData
  try {
    data = await initializeAppData(app.getPath('userData'))
  } catch (error) {
    handleFatalStartup(
      new Error(`无法初始化应用数据目录：${error instanceof Error ? error.message : String(error)}`)
    )
    return
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  windows = new WindowManager()
  const registry = new CommandRegistry()
  const pluginHost = new PluginHost(data.paths.pluginsDirectory)
  const connection = new ConnectionServer(data.loadResult.config.server.token, {
    appVersion: app.getVersion()
  })
  const hotkeys = new HotkeyManager(
    {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
      isRegistered: (accelerator) => globalShortcut.isRegistered(accelerator)
    },
    () => windows?.toggleOverlay()
  )

  appService = new AppService({
    store: data.store,
    loadResult: data.loadResult,
    pluginHost,
    pluginDirectory: data.paths.pluginsDirectory,
    hotkeys,
    connection,
    windows,
    registry,
    setLaunchAtLogin,
    getLaunchAtLogin,
    onStateChanged: (state) => {
      const window = windows?.getSettingsWindow()
      if (window && !window.isDestroyed()) {
        window.webContents.send(ipcChannels.eventSettingsState, state)
      }
    }
  })

  disposeIpc = registerIpcHandlers({ service: appService, windows })
  windows.create()
  tray = new AppTray({
    showSettings: () => windows?.showSettings({ view: 'settings' }),
    reloadPlugins: () => {
      void appService?.reloadPlugins().catch((error) => {
        windows?.sendAppError({
          code: 'PLUGIN_ERROR',
          message: '重新加载插件失败',
          details: error instanceof Error ? error.message : String(error)
        })
      })
    },
    quit: () => app.quit()
  })
  tray.create()

  await appService.initialize()

  if (startHidden) {
    if (process.platform === 'darwin') app.dock?.hide()
  } else {
    windows.showSettings()
  }
}

function handleFatalStartup(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[dihuan-quick-input] startup failed: ${message}`)
  dialog.showErrorBox('Dihuan Quick Input 启动失败', message)
  app.quit()
}

app.on('window-all-closed', () => {
  // The tray application stays alive until the user explicitly quits.
})

app.on('activate', () => {
  windows?.showSettings()
})

app.on('before-quit', (event) => {
  if (shutdownFinished) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  windows?.setQuitting(true)

  void (async () => {
    try {
      await appService?.dispose()
    } catch (error) {
      console.error(
        `[dihuan-quick-input] shutdown cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    disposeIpc?.()
    tray?.destroy()
    windows?.destroy()
    tray = null
    appService = null
    windows = null
    disposeIpc = null
    shutdownFinished = true
    app.quit()
  })()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
