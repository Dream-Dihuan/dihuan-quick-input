import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server as NetServer } from 'node:net'
import { WebSocket } from 'ws'
import {
  ConnectionError,
  ConnectionServer,
  isAllowedExtensionOrigin,
  secureTokenEquals
} from '../../../src/main/connection/connection-server'

const TOKEN = 'test-token-0123456789abcdef0123456789'
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('failed to allocate port'))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

function waitForEvent(emitter: WebSocket, event: string, timeoutMs = 2_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out waiting for ${event}`))
    }, timeoutMs)
    const onEvent = (...args: unknown[]): void => {
      cleanup()
      if (event === 'error') {
        reject(args[0] instanceof Error ? args[0] : new Error(String(args[0])))
        return
      }
      resolve(args.length > 1 ? args : args[0])
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      emitter.removeListener(event, onEvent)
      emitter.removeListener('error', onError)
    }
    emitter.once(event, onEvent)
    emitter.once('error', onError)
  })
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 2_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for message'))
    }, timeoutMs)
    const onMessage = (data: WebSocket.RawData): void => {
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>
        if (predicate(message)) {
          cleanup()
          resolve(message)
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('socket closed before expected message'))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('message', onMessage)
      socket.removeListener('close', onClose)
    }
    socket.on('message', onMessage)
    socket.once('close', onClose)
  })
}

function waitForClose(socket: WebSocket, timeoutMs = 2_000): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for close'))
    }, timeoutMs)
    const onClose = (): void => {
      cleanup()
      resolve()
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('close', onClose)
    }
    socket.once('close', onClose)
  })
}

function withPong(socket: WebSocket): void {
  socket.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as { type?: string; ts?: number }
      if (message.type === 'ping') {
        socket.send(JSON.stringify({ v: 1, type: 'pong', ts: message.ts }))
      }
    } catch {
      // Ignore malformed messages in the fake client.
    }
  })
}

describe('connection server', () => {
  let server: ConnectionServer
  let port: number
  let sockets: WebSocket[]
  let netServers: NetServer[]

  beforeEach(async () => {
    port = await freePort()
    server = new ConnectionServer(TOKEN, {
      ports: [port],
      heartbeatIntervalMs: 60_000,
      insertTimeoutMs: 100,
      handshakeTimeoutMs: 200
    })
    sockets = []
    netServers = []
  })

  afterEach(async () => {
    for (const socket of sockets) {
      socket.terminate()
    }
    for (const netServer of netServers) {
      await new Promise<void>((resolve) => netServer.close(() => resolve()))
    }
    await server.stop()
  })

  async function start(): Promise<string> {
    await server.start()
    return `ws://127.0.0.1:${port}`
  }

  async function connect(
    url: string,
    token = TOKEN,
    origin: string | undefined = ORIGIN
  ): Promise<{ socket: WebSocket; welcome: Record<string, unknown> }> {
    const socket = new WebSocket(url, origin ? { origin } : undefined)
    sockets.push(socket)
    await waitForEvent(socket, 'open')
    const welcomePromise = waitForMessage(
      socket,
      (message) => message.type === 'welcome' || message.type === 'error'
    )
    socket.send(
      JSON.stringify({
        v: 1,
        type: 'hello',
        token,
        extensionVersion: '1.2.3',
        browserName: 'Chrome'
      })
    )
    const message = await welcomePromise
    if (message.type !== 'welcome') {
      throw new Error(`handshake failed: ${String(message.message)}`)
    }
    return { socket, welcome: message }
  }

  it('accepts a correct token and rejects a wrong token', async () => {
    const url = await start()
    const { socket } = await connect(url)
    expect(server.getConnections()).toHaveLength(1)
    expect(server.getSnapshot()).toMatchObject({
      port,
      connections: [
        {
          browserName: 'Chrome',
          extensionVersion: '1.2.3'
        }
      ]
    })

    const bad = new WebSocket(url, { origin: ORIGIN })
    sockets.push(bad)
    await waitForEvent(bad, 'open')
    const errorPromise = waitForMessage(bad, (message) => message.type === 'error')
    bad.send(
      JSON.stringify({
        v: 1,
        type: 'hello',
        token: 'wrong-token-0123456789',
        extensionVersion: '1.2.3',
        browserName: 'Edge'
      })
    )
    expect(await errorPromise).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' })
    await waitForClose(bad)
    expect(server.getConnections()).toHaveLength(1)
    expect(server.getSnapshot().lastError).toMatchObject({ code: 'UNAUTHORIZED' })

    socket.terminate()
    await waitForClose(socket)
  })

  it('rejects non-extension origins and missing origins', async () => {
    const url = await start()

    const foreign = new WebSocket(url, { origin: 'https://example.com' })
    const foreignError = waitForEvent(foreign, 'error')
    await expect(foreignError).rejects.toThrow()
    foreign.terminate()

    const missingOrigin = new WebSocket(url)
    const missingError = waitForEvent(missingOrigin, 'error')
    await expect(missingError).rejects.toThrow()
    missingOrigin.terminate()

    expect(isAllowedExtensionOrigin(ORIGIN)).toBe(true)
    expect(isAllowedExtensionOrigin('https://example.com')).toBe(false)
    expect(isAllowedExtensionOrigin(undefined)).toBe(false)
  })

  it('falls back to the next port when the first is occupied', async () => {
    const occupied = createServer()
    netServers.push(occupied)
    const firstPort = await new Promise<number>((resolve, reject) => {
      occupied.once('error', reject)
      occupied.listen(0, '127.0.0.1', () => {
        const address = occupied.address()
        if (!address || typeof address === 'string') {
          reject(new Error('failed to allocate port'))
          return
        }
        resolve(address.port)
      })
    })
    const secondPort = await freePort()

    const fallback = new ConnectionServer(TOKEN, { ports: [firstPort, secondPort] })
    try {
      await expect(fallback.start()).resolves.toBe(secondPort)
      expect(fallback.getPort()).toBe(secondPort)
    } finally {
      await fallback.stop()
    }
  })

  it('times out unauthenticated handshakes', async () => {
    const url = await start()
    const socket = new WebSocket(url, { origin: ORIGIN })
    sockets.push(socket)
    await waitForEvent(socket, 'open')
    await waitForClose(socket, 1_000)
    expect(server.getConnections()).toHaveLength(0)
  })

  it('disconnects clients that miss three heartbeats', async () => {
    await server.stop()
    server = new ConnectionServer(TOKEN, {
      ports: [port],
      heartbeatIntervalMs: 20,
      insertTimeoutMs: 100,
      handshakeTimeoutMs: 200
    })
    const url = await start()
    const { socket } = await connect(url)
    await waitForClose(socket, 1_000)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.getConnections()).toHaveLength(0)
  })

  it('keeps responding clients connected through heartbeats', async () => {
    await server.stop()
    server = new ConnectionServer(TOKEN, {
      ports: [port],
      heartbeatIntervalMs: 20,
      insertTimeoutMs: 100,
      handshakeTimeoutMs: 200
    })
    const url = await start()
    const { socket } = await connect(url)
    withPong(socket)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(socket.readyState).toBe(WebSocket.OPEN)
    expect(server.getConnections()).toHaveLength(1)
  })

  it('routes an insert only to the most recently focused connection', async () => {
    const url = await start()
    const chrome = await connect(url)
    const edge = await connect(url)

    chrome.socket.send(JSON.stringify({ v: 1, type: 'page-focus', ts: 100 }))
    edge.socket.send(JSON.stringify({ v: 1, type: 'page-focus', ts: 200 }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    let chromeReceivedInsert = false
    chrome.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as { type?: string }
      if (message.type === 'insert') chromeReceivedInsert = true
    })

    const insertPromise = server.insert('张三', 'caret')
    const request = await waitForMessage(edge.socket, (message) => message.type === 'insert')
    expect(request).toMatchObject({ type: 'insert', text: '张三', mode: 'caret' })

    edge.socket.send(
      JSON.stringify({
        v: 1,
        type: 'insert-result',
        id: request.id,
        ok: true
      })
    )
    await expect(insertPromise).resolves.toMatchObject({ browserName: 'Chrome' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(chromeReceivedInsert).toBe(false)
  })

  it('returns explicit errors when no target is available', async () => {
    await expect(server.insert('张三', 'caret')).rejects.toMatchObject({
      code: 'SERVER_ERROR'
    })

    const url = await start()
    await connect(url)
    await expect(server.insert('张三', 'caret')).rejects.toMatchObject({
      code: 'TARGET_UNKNOWN'
    })

    const second = await connect(url)
    await expect(server.insert('张三', 'caret')).rejects.toMatchObject({
      code: 'TARGET_UNKNOWN'
    })
    second.socket.terminate()
    await waitForClose(second.socket)
  })

  it('maps failed insert results and enforces the timeout', async () => {
    const url = await start()
    const { socket } = await connect(url)
    socket.send(JSON.stringify({ v: 1, type: 'page-focus', ts: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 10))

    const failed = server.insert('张三', 'caret')
    const failedRequest = await waitForMessage(socket, (message) => message.type === 'insert')
    socket.send(
      JSON.stringify({
        v: 1,
        type: 'insert-result',
        id: failedRequest.id,
        ok: false,
        code: 'NO_FIELD',
        message: '找不到字段'
      })
    )
    await expect(failed).rejects.toMatchObject({
      code: 'NO_FIELD',
      message: '找不到字段'
    })

    await server.stop()
    server = new ConnectionServer(TOKEN, {
      ports: [port],
      heartbeatIntervalMs: 60_000,
      insertTimeoutMs: 30,
      handshakeTimeoutMs: 200
    })
    const url2 = await start()
    const second = await connect(url2)
    second.socket.send(JSON.stringify({ v: 1, type: 'page-focus', ts: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 10))

    const timedOut = server.insert('李四', 'replace')
    const timedOutRequest = await waitForMessage(
      second.socket,
      (message) => message.type === 'insert'
    )
    await expect(timedOut).rejects.toMatchObject({ code: 'INSERT_TIMEOUT' })

    // A late result is ignored and must not throw.
    second.socket.send(
      JSON.stringify({
        v: 1,
        type: 'insert-result',
        id: timedOutRequest.id,
        ok: true
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('rejects pending inserts when the target disconnects', async () => {
    const url = await start()
    const { socket } = await connect(url)
    socket.send(JSON.stringify({ v: 1, type: 'page-focus', ts: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 10))

    const insert = server.insert('张三', 'caret')
    await waitForMessage(socket, (message) => message.type === 'insert')
    socket.terminate()
    await expect(insert).rejects.toMatchObject({ code: 'EXTENSION_DISCONNECTED' })
  })

  it('rotates the token and disconnects existing clients', async () => {
    const url = await start()
    const { socket } = await connect(url)
    const closed = waitForClose(socket)
    server.setToken('rotated-token-0123456789abcdef')
    await closed
    expect(server.getConnections()).toHaveLength(0)

    const oldSocket = new WebSocket(url, { origin: ORIGIN })
    sockets.push(oldSocket)
    await waitForEvent(oldSocket, 'open')
    const oldError = waitForMessage(oldSocket, (message) => message.type === 'error')
    oldSocket.send(
      JSON.stringify({
        v: 1,
        type: 'hello',
        token: TOKEN,
        extensionVersion: '1.2.3',
        browserName: 'Chrome'
      })
    )
    expect(await oldError).toMatchObject({ code: 'UNAUTHORIZED' })
    await waitForClose(oldSocket)

    const rotated = await connect(url, 'rotated-token-0123456789abcdef')
    expect(rotated.welcome.type).toBe('welcome')
  })

  it('notifies listeners about connection state changes', async () => {
    const snapshots: number[] = []
    server.onChanged((snapshot) => snapshots.push(snapshot.connections.length))
    const url = await start()
    const { socket } = await connect(url)
    socket.terminate()
    await waitForClose(socket)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(snapshots).toContain(1)
    expect(snapshots.at(-1)).toBe(0)
  })

  it('compares tokens in constant time for equal and different lengths', () => {
    expect(secureTokenEquals('abc', 'abc')).toBe(true)
    expect(secureTokenEquals('abc', 'abd')).toBe(false)
    expect(secureTokenEquals('abc', 'abcdef')).toBe(false)
    expect(() => new ConnectionError('UNKNOWN', 'x')).not.toThrow()
  })
})
