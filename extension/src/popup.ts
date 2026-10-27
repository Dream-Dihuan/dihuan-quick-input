import { runtimeMessage } from './messages'

const TOKEN_KEY = 'qia.pairingToken'

interface PopupStatus {
  connected: boolean
  port: number | null
  lastError: string
  tokenConfigured: boolean
  browserName: string
  extensionVersion: string
}

const tokenInput = document.querySelector<HTMLInputElement>('#token')
const saveButton = document.querySelector<HTMLButtonElement>('#save')
const clearButton = document.querySelector<HTMLButtonElement>('#clear')
const statusElement = document.querySelector<HTMLParagraphElement>('#status')

if (!tokenInput || !saveButton || !clearButton || !statusElement) {
  throw new Error('Popup markup is incomplete')
}

const input = tokenInput
const save = saveButton
const clear = clearButton
const status = statusElement

function setStatus(message: string, kind: 'ok' | 'error' | 'idle' = 'idle'): void {
  status.textContent = message
  status.className = `status ${kind === 'idle' ? '' : kind}`.trim()
}

async function loadToken(): Promise<void> {
  const stored = await chrome.storage.local.get(TOKEN_KEY)
  const value = stored[TOKEN_KEY]
  input.value = typeof value === 'string' ? value : ''
}

async function refreshStatus(): Promise<void> {
  try {
    const result = (await chrome.runtime.sendMessage({
      type: runtimeMessage.getStatus
    })) as PopupStatus | undefined
    if (!result) {
      setStatus('后台服务未响应', 'error')
      return
    }
    if (!result.tokenConfigured) {
      setStatus('未配置配对令牌', 'idle')
      return
    }
    if (result.connected) {
      setStatus(`已连接 · ${result.browserName} · 端口 ${result.port ?? '-'}`, 'ok')
      return
    }
    setStatus(result.lastError ? `未连接：${result.lastError}` : '正在连接…', 'error')
  } catch (error) {
    setStatus(`后台服务未响应${error instanceof Error ? `：${error.message}` : ''}`, 'error')
  }
}

async function saveToken(): Promise<void> {
  const token = input.value.trim()
  if (token.length < 16) {
    setStatus('配对令牌长度无效，请从桌面应用复制完整令牌', 'error')
    return
  }
  save.disabled = true
  try {
    await chrome.storage.local.set({ [TOKEN_KEY]: token })
    await chrome.runtime.sendMessage({ type: runtimeMessage.reconnect })
    setStatus('已保存，正在连接…', 'idle')
    window.setTimeout(() => {
      void refreshStatus()
    }, 350)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    save.disabled = false
  }
}

async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY)
  input.value = ''
  setStatus('配对令牌已清除', 'idle')
  window.setTimeout(() => {
    void refreshStatus()
  }, 150)
}

save.addEventListener('click', () => {
  void saveToken()
})
clear.addEventListener('click', () => {
  void clearToken()
})
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    void saveToken()
  }
})

void loadToken().then(refreshStatus)
const timer = window.setInterval(() => {
  void refreshStatus()
}, 1_000)
window.addEventListener('unload', () => window.clearInterval(timer))
