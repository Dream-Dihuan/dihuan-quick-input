import type { ServerInsert } from '@shared/protocol'
import { detectBrowserName } from './browser'
import { ExtensionConnectionClient } from './connection-client'
import {
  runtimeMessage,
  type FocusStateRequest,
  type GetStatusRequest,
  type InsertOutcome,
  type InsertTextRequest,
  type PageFocusRequest
} from './messages'

const TOKEN_KEY = 'qia.pairingToken'
const RECONNECT_ALARM = 'qia-reconnect'

interface TabFocus {
  frameId: number
  lastFocusAt: number
}

const tabFocus = new Map<number, TabFocus>()
const browserName = detectBrowserName(navigator.userAgent)
const extensionVersion = chrome.runtime.getManifest().version

async function getToken(): Promise<string> {
  const stored = await chrome.storage.local.get(TOKEN_KEY)
  const value = stored[TOKEN_KEY]
  return typeof value === 'string' ? value : ''
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (tabs[0]) return tabs[0]
  const fallback = await chrome.tabs.query({ active: true, currentWindow: true })
  return fallback[0] ?? null
}

async function requestFocusState(tabId: number): Promise<void> {
  const message: FocusStateRequest = { type: runtimeMessage.focusStateRequest }
  try {
    await chrome.tabs.sendMessage(tabId, message)
  } catch {
    // No content script in this tab, or the tab is navigating.
  }
}

async function restoreFocus(): Promise<void> {
  const tab = await activeTab()
  if (!tab?.id) return
  const focus = tabFocus.get(tab.id)
  if (focus && client.getStatus().connected) {
    client.notifyPageFocus(focus.lastFocusAt)
  } else {
    await requestFocusState(tab.id)
  }
}

const client = new ExtensionConnectionClient({
  getToken,
  browserName,
  extensionVersion,
  onStatus: (status) => {
    if (status.connected) void restoreFocus()
  },
  onInsert: handleInsert
})

async function handleInsert(request: ServerInsert): Promise<InsertOutcome> {
  const tab = await activeTab()
  if (!tab?.id) {
    return { ok: false, code: 'NO_FIELD', message: '没有活动的浏览器标签页' }
  }

  let focus = tabFocus.get(tab.id)
  if (!focus) {
    await requestFocusState(tab.id)
    await delay(100)
    focus = tabFocus.get(tab.id)
  }
  if (!focus) {
    return {
      ok: false,
      code: 'NO_FIELD',
      message: '当前页面没有聚焦的可编辑字段'
    }
  }

  const message: InsertTextRequest = {
    type: runtimeMessage.insertText,
    id: request.id,
    text: request.text,
    mode: request.mode
  }

  try {
    const response = (await chrome.tabs.sendMessage(tab.id, message, {
      frameId: focus.frameId
    })) as InsertOutcome | undefined
    if (response?.ok) return { ok: true }

    if (response?.code === 'NO_FIELD') {
      tabFocus.delete(tab.id)
    }
    return {
      ok: false,
      code: allowedCode(response?.code),
      message: response?.message ?? '扩展写入字段失败'
    }
  } catch {
    tabFocus.delete(tab.id)
    return {
      ok: false,
      code: 'NO_FIELD',
      message: '当前页面没有聚焦的可编辑字段'
    }
  }
}

function allowedCode(code: string | undefined): string {
  if (code === 'NO_FIELD' || code === 'INSERT_FAILED' || code === 'INVALID_PAYLOAD') {
    return code
  }
  return 'INSERT_FAILED'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function popupStatus(): Record<string, unknown> {
  return {
    ...client.getStatus(),
    browserName,
    extensionVersion
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (!message || typeof message !== 'object') return false
    const type = (message as { type?: unknown }).type

    if (type === runtimeMessage.pageFocus) {
      const tabId = sender.tab?.id
      if (tabId === undefined) return false
      const request = message as PageFocusRequest
      const ts = Number.isFinite(request.ts) && request.ts > 0 ? request.ts : Date.now()
      tabFocus.set(tabId, {
        frameId: sender.frameId ?? 0,
        lastFocusAt: ts
      })
      if (client.getStatus().connected) client.notifyPageFocus(ts)
      return false
    }

    if (type === runtimeMessage.getStatus) {
      void (message as GetStatusRequest)
      sendResponse(popupStatus())
      return false
    }

    if (type === runtimeMessage.reconnect) {
      void client.reconnectNow()
      sendResponse({ ok: true })
      return false
    }

    if (type === runtimeMessage.tokenUpdated) {
      void client.restart()
      sendResponse({ ok: true })
      return false
    }

    return false
  }
)

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[TOKEN_KEY]) return
  tabFocus.clear()
  void client.restart()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  tabFocus.delete(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    tabFocus.delete(tabId)
  }
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void requestFocusState(tabId)
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RECONNECT_ALARM) return
  if (!client.getStatus().connected) {
    void client.reconnectNow()
  }
})

chrome.runtime.onInstalled.addListener(() => {
  void initialize()
})

chrome.runtime.onStartup.addListener(() => {
  void initialize()
})

function initialize(): Promise<void> {
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 })
  return client.start()
}

void initialize()
