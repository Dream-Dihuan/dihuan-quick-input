import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { ServerInsert } from '@shared/protocol'
import {
  ExtensionConnectionClient,
  type ConnectionStatus,
  type SocketLike
} from '../../../extension/src/connection-client'

interface TestServer {
  wss: WebSocketServer
  port: number
  messages: Array<{ socket: WebSocket; message: Record<string, unknown> }>
}

const servers: WebSocketServer[] = []
const clients: ExtensionConnectionClient[] = []

async function startServer(
  onHello: (socket: WebSocket, hello: Record<string, unknown>, attempt: number) => void
): Promise<TestServer> {
  const wss = new WebSocketServer({ port: 0 })
  servers.push(wss)
  const messages: TestServer['messages'] = []
  let attempt = 0
  wss.on('connection', (socket, request) => {
    messages.push({ socket, message: { origin: request.headers.origin } })
    attempt += 1
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>
      messages.push({ socket, message })
      if (message.type === 'hello') onHello(socket, message, attempt)
    })
  })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address()
  if (typeof address === 'string' || !address) throw new Error('server address unavailable')
  return { wss, port: address.port, messages }
}

function createClient(
  port: number,
  onInsert: (request: ServerInsert) => Promise<{ ok: boolean; code?: string; message?: string }>,
  statuses: ConnectionStatus[],
  options: { token?: string; reconnectDelaysMs?: number[]; handshakeTimeoutMs?: number } = {}
): ExtensionConnectionClient {
  const client = new ExtensionConnectionClient({
    getToken: async () => options.token ?? 'a'.repeat(32),
    browserName: 'Chrome',
    extensionVersion: '0.1.0',
    ports: [port],
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 300,
    reconnectDelaysMs: options.reconnectDelaysMs ?? [10, 20],
    onStatus: (status) => statuses.push(status),
    onInsert,
    createSocket: (url) =>
      new WebSocket(url, { origin: 'chrome-extension://test' }) as unknown as SocketLike
  })
  clients.push(client)
  return client
}

function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error('condition timed out'))
      }
    }, 5)
  })
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop()
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
    )
  )
})

describe('extension connection client', () => {
  it('handshakes with the expected origin/token, responds to ping and returns insert results', async () => {
    const inserts: ServerInsert[] = []
    const server = await startServer((socket, hello) => {
      expect(hello.token).toBe('a'.repeat(32))
      socket.send(
        JSON.stringify({
          v: 1,
          type: 'welcome',
          appVersion: '1.0.0',
          heartbeatMs: 20_000
        })
      )
    })
    const statuses: ConnectionStatus[] = []
    const client = createClient(
      server.port,
      async (request) => {
        inserts.push(request)
        return { ok: true }
      },
      statuses
    )

    await client.start()
    await waitFor(() => client.getStatus().connected)

    expect(server.messages[0]?.message.origin).toBe('chrome-extension://test')
    expect(client.getStatus()).toMatchObject({ connected: true, port: server.port })

    const socket = server.messages.find((entry) => entry.message.type === 'hello')?.socket
    socket?.send(JSON.stringify({ v: 1, type: 'ping', ts: 123 }))
    await waitFor(() =>
      server.messages.some((entry) => entry.message.type === 'pong' && entry.message.ts === 123)
    )

    socket?.send(
      JSON.stringify({ v: 1, type: 'insert', id: 'insert-1', text: '你好', mode: 'caret' })
    )
    await waitFor(() => inserts.length === 1)
    expect(inserts[0]).toMatchObject({ id: 'insert-1', text: '你好', mode: 'caret' })
    await waitFor(() =>
      server.messages.some(
        (entry) =>
          entry.message.type === 'insert-result' &&
          entry.message.id === 'insert-1' &&
          entry.message.ok === true
      )
    )
  })

  it('reports authentication failures without reconnecting', async () => {
    const server = await startServer((socket) => {
      socket.send(
        JSON.stringify({
          v: 1,
          type: 'error',
          code: 'UNAUTHORIZED',
          message: '配对令牌无效'
        })
      )
    })
    const statuses: ConnectionStatus[] = []
    const client = createClient(server.port, async () => ({ ok: true }), statuses)

    await client.start()
    expect(client.getStatus()).toMatchObject({
      connected: false,
      lastError: '配对令牌无效'
    })
    expect(server.messages.filter((entry) => entry.message.type === 'hello')).toHaveLength(1)
  })

  it('reconnects after a dropped handshake and then completes the handshake', async () => {
    const server = await startServer((socket, _hello, attempt) => {
      if (attempt === 1) {
        socket.terminate()
        return
      }
      socket.send(
        JSON.stringify({
          v: 1,
          type: 'welcome',
          appVersion: '1.0.0',
          heartbeatMs: 20_000
        })
      )
    })
    const statuses: ConnectionStatus[] = []
    const client = createClient(server.port, async () => ({ ok: true }), statuses, {
      reconnectDelaysMs: [10],
      handshakeTimeoutMs: 100
    })

    await client.start()
    await waitFor(() => client.getStatus().connected)
    expect(
      server.messages.filter((entry) => entry.message.type === 'hello').length
    ).toBeGreaterThanOrEqual(2)
  })

  it('reports a missing token without opening a socket', async () => {
    const server = await startServer(() => undefined)
    const statuses: ConnectionStatus[] = []
    const client = createClient(server.port, async () => ({ ok: true }), statuses, {
      token: ''
    })
    await client.start()
    expect(client.getStatus()).toMatchObject({
      connected: false,
      tokenConfigured: false,
      lastError: '尚未配置配对令牌'
    })
    expect(server.messages).toHaveLength(0)
  })
})
