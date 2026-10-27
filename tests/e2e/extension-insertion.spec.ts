import { expect, test } from '@playwright/test'
import { chromium, type BrowserContext, type Worker } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'

interface BridgeMessage {
  type?: string
  [key: string]: unknown
}

class TestBridge {
  private server: WebSocketServer | null = null
  private socket: WebSocket | null = null
  readonly messages: BridgeMessage[] = []
  readonly token = 'e2e'.repeat(16)

  async start(): Promise<void> {
    let lastError: unknown
    for (let port = 47821; port <= 47830; port += 1) {
      const server = new WebSocketServer({ host: '127.0.0.1', port })
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('listening', resolve)
          server.once('error', reject)
        })
        this.server = server
        break
      } catch (error) {
        lastError = error
        server.close()
      }
    }
    if (!this.server) throw lastError ?? new Error('no free bridge port')

    this.server.on('connection', (socket) => {
      this.socket = socket
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as BridgeMessage
        this.messages.push(message)
        if (message.type === 'hello' && message.token !== this.token) {
          socket.send(
            JSON.stringify({
              v: 1,
              type: 'error',
              code: 'UNAUTHORIZED',
              message: 'token mismatch'
            })
          )
          socket.close()
          return
        }
        if (message.type === 'hello') {
          socket.send(
            JSON.stringify({
              v: 1,
              type: 'welcome',
              appVersion: '1.0.0',
              heartbeatMs: 20_000
            })
          )
        }
      })
    })
  }

  clear(): void {
    this.messages.length = 0
  }

  async stop(): Promise<void> {
    this.socket?.close()
    this.socket = null
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
    this.server = null
  }

  async waitFor<T extends BridgeMessage>(
    predicate: (message: BridgeMessage) => boolean,
    timeout = 8_000
  ): Promise<T> {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const found = this.messages.find(predicate)
      if (found) return found as T
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('timed out waiting for bridge message')
  }

  async waitForConnection(): Promise<void> {
    await this.waitFor((message) => message.type === 'hello')
  }

  sendInsert(text: string, mode: 'caret' | 'replace' = 'caret'): string {
    const id = `insert-${Date.now()}-${Math.random().toString(16).slice(2)}`
    this.socket?.send(JSON.stringify({ v: 1, type: 'insert', id, text, mode }))
    return id
  }

  waitForResult(id: string): Promise<BridgeMessage & { ok: boolean; code?: string }> {
    return this.waitFor((message) => message.type === 'insert-result' && message.id === id)
  }
}

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>E2E</title></head>
<body style="padding: 30px; font-family: sans-serif">
  <input id="text" type="text" value="hello" style="width: 300px; padding: 6px">
  <textarea id="area" style="width: 300px; height: 60px">area</textarea>
  <div id="editor" contenteditable="true" tabindex="0" style="min-height: 40px; border: 1px solid #ccc">old</div>
  <iframe id="frame" src="__FRAME_URL__" style="width: 400px; height: 100px"></iframe>
</body></html>`

const frameHtml = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body><input id="inner" type="text" style="width: 250px; padding: 6px"></body></html>`

let httpServer: Server
let frameHttpServer: Server
let baseUrl: string
let crossOriginFrameUrl: string
let extensionId: string
let context: BrowserContext
let worker: Worker
let bridge: TestBridge
let userDataDir: string

test.beforeAll(async () => {
  httpServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url === '/frame') {
      response.end(frameHtml)
    } else if (request.url === '/empty') {
      response.end('<!doctype html><html><body>empty page</body></html>')
    } else if (request.url === '/cross-origin') {
      response.end(pageHtml.replace('__FRAME_URL__', crossOriginFrameUrl))
    } else {
      response.end(pageHtml.replace('__FRAME_URL__', '/frame'))
    }
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  if (typeof address === 'string' || !address) throw new Error('http server failed')
  baseUrl = `http://127.0.0.1:${address.port}`

  frameHttpServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(frameHtml)
  })
  await new Promise<void>((resolve) => frameHttpServer.listen(0, '127.0.0.1', resolve))
  const frameAddress = frameHttpServer.address()
  if (typeof frameAddress === 'string' || !frameAddress) throw new Error('frame server failed')
  crossOriginFrameUrl = `http://127.0.0.1:${frameAddress.port}/frame`

  bridge = new TestBridge()
  await bridge.start()

  userDataDir = await mkdtemp(join(tmpdir(), 'dqi-playwright-'))
  const extensionPath = resolve('dist-extension')
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ]
  })

  const existing = context.serviceWorkers()[0]
  worker = existing ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }))
  extensionId = new URL(worker.url()).host
  await worker.evaluate(
    async ({ key, token }) => {
      await chrome.storage.local.set({ [key]: token })
    },
    { key: 'qia.pairingToken', token: bridge.token }
  )

  // A service worker can start just after storage was written, so explicitly
  // wake the reconnect path from an extension page as well.
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (bridge.messages.some((message) => message.type === 'hello')) break
    try {
      await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'qia:reconnect' }))
    } catch {
      // The service worker may still be starting.
    }
    await popup.waitForTimeout(200)
  }
  await popup.close()
  await bridge.waitForConnection()
})

test.afterAll(async () => {
  await context?.close()
  await bridge?.stop()
  await Promise.all(
    [httpServer, frameHttpServer].map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server) return resolve()
          server.close(() => resolve())
        })
    )
  )
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
})

test('inserts into focused input and contenteditable via the extension', async () => {
  const page = await context.newPage()
  await page.goto(baseUrl)
  await page.locator('#text').evaluate((element: HTMLInputElement) => {
    element.focus()
    element.value = 'hello'
    element.setSelectionRange(5, 5)
  })
  await bridge.waitFor((message) => message.type === 'page-focus')

  const inputId = bridge.sendInsert(' world')
  await expect.poll(async () => (await bridge.waitForResult(inputId)).ok).toBe(true)
  await expect(page.locator('#text')).toHaveValue('hello world')

  await page.locator('#editor').focus()
  await bridge.waitFor((message) => message.type === 'page-focus')
  const editorId = bridge.sendInsert('editor text', 'replace')
  await expect.poll(async () => (await bridge.waitForResult(editorId)).ok).toBe(true)
  await expect(page.locator('#editor')).toHaveText('editor text')
})

test('routes insertion to a focused iframe and never writes an inactive tab', async () => {
  const page = await context.newPage()
  await page.goto(baseUrl)
  const frame = page.frameLocator('#frame')
  await frame.locator('#inner').focus()
  await bridge.waitFor((message) => message.type === 'page-focus')
  await page.waitForTimeout(100)

  const frameId = bridge.sendInsert('iframe text', 'replace')
  await expect.poll(async () => (await bridge.waitForResult(frameId)).ok).toBe(true)
  await expect(frame.locator('#inner')).toHaveValue('iframe text')

  const second = await context.newPage()
  await second.goto(`${baseUrl}/empty`)
  await second.bringToFront()
  await second.locator('body').click()
  const noFieldId = bridge.sendInsert('must not appear')
  const noField = await bridge.waitForResult(noFieldId)
  expect(noField.ok).toBe(false)
  expect(noField.code).toBe('NO_FIELD')
  await expect(frame.locator('#inner')).toHaveValue('iframe text')
})

test('inserts into the last field after the browser window loses focus', async () => {
  const page = await context.newPage()
  await page.goto(baseUrl)
  await page.locator('#text').evaluate((element: HTMLInputElement) => {
    element.focus()
    element.value = 'hello'
    element.setSelectionRange(5, 5)
  })
  await bridge.waitFor((message) => message.type === 'page-focus')

  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    // Simulate switching from Chrome to the desktop overlay. The page stays
    // the active tab, but its window no longer has OS keyboard focus.
    window.dispatchEvent(new Event('blur'))
  })
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('text')

  const inputId = bridge.sendInsert(' world')
  const result = await bridge.waitForResult(inputId)
  expect(result.ok).toBe(true)
  await expect(page.locator('#text')).toHaveValue('hello world')
})

test('popup rejects an invalid token and shows the connection error', async () => {
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.locator('#token').fill('bad-token-value'.repeat(3))
  await popup.locator('#save').click()
  await expect(popup.locator('#status')).toContainText('未连接', { timeout: 10_000 })
  await expect(popup.locator('#status')).toContainText('token mismatch')
})
