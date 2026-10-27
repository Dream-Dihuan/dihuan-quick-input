import { BrowserWindow, app, screen, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import { ipcChannels, type OverlayResult } from '@shared/ipc'
import type { AppErrorInfo } from '@shared/errors'
import { OverlayFocusTracker, shouldHideOverlayOnShortcut } from './overlay-behavior'

const OVERLAY_WIDTH = 560
const OVERLAY_HEIGHT = 96

function rendererUrl(page: string): string | null {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}/${page}`
  }
  return null
}

function loadPage(window: BrowserWindow, page: string): void {
  const devUrl = rendererUrl(page)
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, `../renderer/${page}`))
  }
}

function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    spellcheck: false,
    devTools: is.dev
  }
}

function lockNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url)
      }
    }
  })
}

export class WindowManager {
  private settingsWindow: BrowserWindow | null = null
  private overlayWindow: BrowserWindow | null = null
  private overlayReady = false
  private pendingOverlayOpen = false
  private settingsReady = false
  private pendingSettingsShow = false
  private quitting = false
  private overlayFocusRetry: NodeJS.Timeout | null = null
  private readonly overlayFocus = new OverlayFocusTracker()

  create(): void {
    this.createSettingsWindow()
    this.createOverlayWindow()
  }

  setQuitting(quitting: boolean): void {
    this.quitting = quitting
  }

  getSettingsWindow(): BrowserWindow | null {
    return this.settingsWindow
  }

  getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow
  }

  isSettingsSender(senderId: number): boolean {
    return this.settingsWindow?.webContents.id === senderId
  }

  isOverlaySender(senderId: number): boolean {
    return this.overlayWindow?.webContents.id === senderId
  }

  showSettings(): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.createSettingsWindow()
    }
    const window = this.settingsWindow
    if (!window) return
    if (!this.settingsReady) {
      this.pendingSettingsShow = true
      return
    }
    this.pendingSettingsShow = false
    if (process.platform === 'darwin') {
      void app.dock?.show()
    }
    if (window.isMinimized()) window.restore()
    window.show()
    this.activateOnMac()
    window.focus()
  }

  hideSettings(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.hide()
    }
  }

  showOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      this.createOverlayWindow()
    }
    const window = this.overlayWindow
    if (!window) return

    this.positionOverlay(window)
    this.overlayFocus.beginShow()
    window.setAlwaysOnTop(true, process.platform === 'darwin' ? 'screen-saver' : 'floating')
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: process.platform === 'darwin'
    })
    window.show()
    this.activateOnMac()
    window.focus()
    this.scheduleOverlayFocusRetry(window)

    if (this.overlayReady) {
      window.webContents.send(ipcChannels.eventOverlayOpen)
    } else {
      this.pendingOverlayOpen = true
    }
  }

  hideOverlay(): void {
    this.overlayFocus.beginHide()
    this.clearOverlayFocusRetry()
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide()
    }
    this.pendingOverlayOpen = false
  }

  toggleOverlay(): void {
    const window = this.overlayWindow
    if (window && shouldHideOverlayOnShortcut(window.isVisible(), window.isFocused())) {
      this.hideOverlay()
      return
    }
    this.showOverlay()
  }

  sendOverlayResult(result: OverlayResult): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send(ipcChannels.eventOverlayResult, result)
    }
  }

  sendAppError(error: AppErrorInfo): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.webContents.send(ipcChannels.eventAppError, error)
    }
  }

  destroy(): void {
    this.setQuitting(true)
    this.overlayFocus.beginHide()
    this.clearOverlayFocusRetry()
    this.settingsWindow?.destroy()
    this.overlayWindow?.destroy()
    this.settingsWindow = null
    this.overlayWindow = null
  }

  private createSettingsWindow(): void {
    const window = new BrowserWindow({
      width: 1024,
      height: 780,
      minWidth: 860,
      minHeight: 640,
      show: false,
      autoHideMenuBar: true,
      title: 'Dihuan Quick Input',
      icon: process.platform === 'linux' ? icon : undefined,
      webPreferences: secureWebPreferences()
    })
    this.settingsWindow = window
    lockNavigation(window)

    window.on('ready-to-show', () => {
      this.settingsReady = true
      if (this.pendingSettingsShow) {
        this.pendingSettingsShow = false
        this.showSettings()
      }
    })
    window.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      window.hide()
      if (process.platform === 'darwin') {
        app.dock?.hide()
      }
    })
    window.on('closed', () => {
      if (this.settingsWindow === window) {
        this.settingsWindow = null
        this.settingsReady = false
        this.pendingSettingsShow = false
      }
    })

    loadPage(window, 'index.html')
  }

  private createOverlayWindow(): void {
    const window = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      title: 'Dihuan Quick Input',
      webPreferences: secureWebPreferences()
    })
    this.overlayWindow = window
    this.overlayReady = false
    this.overlayFocus.beginHide()
    lockNavigation(window)

    window.setAlwaysOnTop(true, 'floating')
    window.on('focus', () => {
      this.overlayFocus.handleFocus()
    })
    window.on('blur', () => {
      if (!window.isDestroyed() && window.isVisible() && this.overlayFocus.shouldHideOnBlur()) {
        this.hideOverlay()
      }
    })
    window.webContents.on('did-finish-load', () => {
      this.overlayReady = true
      if (this.pendingOverlayOpen && window.isVisible()) {
        this.pendingOverlayOpen = false
        window.webContents.send(ipcChannels.eventOverlayOpen)
      }
    })
    window.on('closed', () => {
      if (this.overlayWindow === window) {
        this.overlayWindow = null
        this.overlayReady = false
        this.overlayFocus.beginHide()
        this.clearOverlayFocusRetry()
      }
    })

    loadPage(window, 'overlay.html')
  }

  private activateOnMac(): void {
    if (process.platform === 'darwin') {
      app.focus({ steal: true })
    }
  }

  /**
   * Activating an accessory macOS app is asynchronous. If the settings window
   * happens to be visible, macOS can give it focus after our immediate
   * window.focus() call. Retry once activation has settled so the overlay is
   * actually able to receive keyboard input.
   */
  private scheduleOverlayFocusRetry(window: BrowserWindow): void {
    this.clearOverlayFocusRetry()
    this.overlayFocusRetry = setTimeout(() => {
      this.overlayFocusRetry = null
      if (window.isDestroyed() || !window.isVisible()) return
      this.activateOnMac()
      window.focus()
    }, 250)
  }

  private clearOverlayFocusRetry(): void {
    if (this.overlayFocusRetry) {
      clearTimeout(this.overlayFocusRetry)
      this.overlayFocusRetry = null
    }
  }

  private positionOverlay(window: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const workArea = display.workArea
    const x = Math.round(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2)
    const y = Math.round(workArea.y + (workArea.height - OVERLAY_HEIGHT) / 2)
    window.setPosition(x, y, false)
  }
}
