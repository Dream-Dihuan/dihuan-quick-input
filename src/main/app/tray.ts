import { Menu, Tray, app, nativeImage } from 'electron'
import trayTemplateIcon from '../../../resources/trayTemplate.png?asset'
import trayWindowsIcon from '../../../resources/tray.ico?asset'

export interface TrayActions {
  showSettings: () => void
  reloadPlugins: () => void
  quit: () => void
}

export class AppTray {
  private tray: Tray | null = null

  constructor(private readonly actions: TrayActions) {}

  create(): void {
    if (this.tray) return
    const image = this.createImage()
    if (image.isEmpty()) return
    this.tray = new Tray(image)
    this.tray.setToolTip('Dihuan Quick Input')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开设置', click: () => this.actions.showSettings() },
        { label: '重新加载插件', click: () => this.actions.reloadPlugins() },
        { type: 'separator' },
        {
          label: `版本 ${app.getVersion()}`,
          enabled: false
        },
        { type: 'separator' },
        { label: '退出', click: () => this.actions.quit() }
      ])
    )
    if (process.platform !== 'darwin') {
      this.tray.on('click', () => this.actions.showSettings())
      this.tray.on('double-click', () => this.actions.showSettings())
    }
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private createImage(): Electron.NativeImage {
    if (process.platform === 'darwin') {
      const image = nativeImage.createFromPath(trayTemplateIcon)
      image.setTemplateImage(true)
      return image
    }
    const image = nativeImage.createFromPath(trayWindowsIcon)
    return image.isEmpty() ? nativeImage.createFromPath(trayTemplateIcon) : image
  }
}
