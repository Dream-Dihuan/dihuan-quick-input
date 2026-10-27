import { app } from 'electron'

export function isHiddenStart(): boolean {
  if (process.argv.includes('--hidden')) return true
  if (process.platform !== 'darwin') return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin
  } catch {
    return false
  }
}

export function getLaunchAtLogin(): boolean {
  try {
    const options: Electron.LoginItemSettingsOptions | undefined =
      process.platform === 'win32' ? { args: ['--hidden'] } : undefined
    return app.getLoginItemSettings(options).openAtLogin
  } catch {
    return false
  }
}

export function setLaunchAtLogin(enabled: boolean): void {
  const settings: Electron.Settings = { openAtLogin: enabled }
  if (process.platform === 'win32') {
    settings.args = enabled ? ['--hidden'] : []
  }
  app.setLoginItemSettings(settings)
}
