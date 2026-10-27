import {
  DEFAULT_PORTS,
  HANDSHAKE_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION
} from '@shared/constants'
import {
  serverMessageSchema,
  type ClientInsertResult,
  type ServerInsert,
  type ServerMessage
} from '@shared/protocol'
import type { InsertOutcome } from './messages'

export interface SocketLike {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  send(data: string): void
  close(): void
}

export type SocketFactory = (url: string) => SocketLike

export interface ConnectionStatus {
  connected: boolean
  port: number | null
  lastError: string
  tokenConfigured: boolean
  reconnectAttempt: number
}

export interface ConnectionClientOptions {
  getToken: () => Promise<string>
  browserName: string
  extensionVersion: string
  onInsert: (request: ServerInsert) => Promise<InsertOutcome>
  onStatus?: (status: ConnectionStatus) => void
  ports?: readonly number[]
  createSocket?: SocketFactory
  handshakeTimeoutMs?: number
  reconnectDelaysMs?: readonly number[]
}

interface HandshakeResult {
  ok: boolean
  fatal: boolean
  message?: string
}

export class ExtensionConnectionClient {
  private readonly ports: readonly number[]
  private readonly createSocket: SocketFactory
  private readonly handshakeTimeoutMs: number
  private readonly reconnectDelaysMs: readonly number[]
  private socket: SocketLike | null = null
  private port: number | null = null
  private connected = false
  private connecting: Promise<void> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private stopped = true
  private tokenConfigured = false
  private lastError = ''

  constructor(private readonly options: ConnectionClientOptions) {
    this.ports = options.ports ?? DEFAULT_PORTS
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as SocketLike)
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [500, 1_000, 2_000, 5_000, 10_000]
  }

  getStatus(): ConnectionStatus {
    return {
      connected: this.connected,
      port: this.port,
      lastError: this.lastError,
      tokenConfigured: this.tokenConfigured,
      reconnectAttempt: this.reconnectAttempt
    }
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  async restart(): Promise<void> {
    this.stop()
    this.stopped = false
    this.reconnectAttempt = 0
    await this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const socket = this.socket
    this.socket = null
    this.connected = false
    this.port = null
    try {
      socket?.close()
    } catch {
      // The socket may already be closed.
    }
    this.emitStatus()
  }

  async reconnectNow(): Promise<void> {
    if (this.connected) return
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    await this.connect()
  }

  notifyPageFocus(ts: number): void {
    if (!this.connected || !this.socket) return
    this.send({
      v: PROTOCOL_VERSION,
      type: 'page-focus',
      ts
    })
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connected) return
    if (this.connecting) return this.connecting
    this.connecting = this.connectOnce().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async connectOnce(): Promise<void> {
    let token: string
    try {
      token = (await this.options.getToken()).trim()
    } catch {
      token = ''
    }
    this.tokenConfigured = token.length > 0
    if (!token) {
      this.connected = false
      this.port = null
      this.lastError = '尚未配置配对令牌'
      this.emitStatus()
      return
    }

    let lastFailure = ''
    for (const port of this.ports) {
      if (this.stopped) return
      let socket: SocketLike
      try {
        socket = this.createSocket(`ws://127.0.0.1:${port}`)
      } catch {
        lastFailure = '无法创建本地连接'
        continue
      }

      try {
        await this.waitForOpen(socket)
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error)
        this.closeSocket(socket)
        continue
      }

      const handshake = await this.handshake(socket, token)
      if (this.stopped) {
        this.closeSocket(socket)
        return
      }
      if (handshake.ok) {
        this.attach(socket, port)
        return
      }

      this.closeSocket(socket)
      if (handshake.fatal) {
        this.connected = false
        this.port = null
        this.lastError = handshake.message ?? '配对失败'
        this.emitStatus()
        return
      }
      lastFailure = handshake.message ?? lastFailure
    }

    if (this.stopped) return
    this.connected = false
    this.port = null
    this.lastError = lastFailure || '无法连接桌面应用，请确认应用已启动'
    this.emitStatus()
    this.scheduleReconnect()
  }

  private waitForOpen(socket: SocketLike): Promise<void> {
    if (socket.readyState === 1) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error('连接桌面应用超时'))
      }, this.handshakeTimeoutMs)

      const cleanup = (): void => {
        clearTimeout(timer)
        socket.onopen = null
        socket.onerror = null
        socket.onclose = null
      }
      const succeed = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const fail = (): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error('无法连接桌面应用'))
      }

      socket.onopen = succeed
      socket.onerror = fail
      socket.onclose = fail
    })
  }

  private handshake(socket: SocketLike, token: string): Promise<HandshakeResult> {
    return new Promise((resolve) => {
      let settled = false
      const timer = setTimeout(
        () => finish({ ok: false, fatal: false, message: '握手超时' }),
        this.handshakeTimeoutMs
      )

      const finish = (result: HandshakeResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.onmessage = null
        socket.onclose = null
        socket.onerror = null
        resolve(result)
      }

      socket.onmessage = (event) => {
        const message = parseServerMessage(event.data)
        if (!message) return
        if (message.type === 'welcome') {
          finish({ ok: true, fatal: false })
        } else if (message.type === 'error') {
          finish({ ok: false, fatal: true, message: message.message || '配对失败' })
        }
      }
      socket.onclose = () => finish({ ok: false, fatal: false, message: '握手时连接被关闭' })
      socket.onerror = () => finish({ ok: false, fatal: false, message: '握手时连接出错' })

      try {
        socket.send(
          JSON.stringify({
            v: PROTOCOL_VERSION,
            type: 'hello',
            token,
            extensionVersion: this.options.extensionVersion,
            browserName: this.options.browserName
          })
        )
      } catch {
        finish({ ok: false, fatal: false, message: '发送配对请求失败' })
      }
    })
  }

  private attach(socket: SocketLike, port: number): void {
    this.socket = socket
    this.port = port
    this.connected = true
    this.reconnectAttempt = 0
    this.lastError = ''
    socket.onopen = null
    socket.onerror = () => undefined
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.connected = false
      this.port = null
      this.lastError = '与桌面应用的连接已断开'
      this.emitStatus()
      this.scheduleReconnect()
    }
    socket.onmessage = (event) => this.handleMessage(event.data)
    this.emitStatus()
  }

  private handleMessage(data: unknown): void {
    const message = parseServerMessage(data)
    if (!message) return

    if (message.type === 'ping') {
      this.send({
        v: PROTOCOL_VERSION,
        type: 'pong',
        ts: message.ts
      })
      return
    }

    if (message.type === 'insert') {
      void this.handleInsert(message)
      return
    }

    if (message.type === 'error') {
      this.lastError = message.message || '桌面应用报告错误'
      this.emitStatus()
      if (message.code === 'UNAUTHORIZED' || message.code === 'PROTOCOL_ERROR') {
        const socket = this.socket
        this.socket = null
        this.connected = false
        this.port = null
        this.closeSocket(socket)
        this.emitStatus()
      }
    }
  }

  private async handleInsert(message: ServerInsert): Promise<void> {
    let outcome: InsertOutcome
    try {
      outcome = await this.options.onInsert(message)
    } catch {
      outcome = { ok: false, code: 'INSERT_FAILED', message: '扩展写入字段失败' }
    }

    const result: ClientInsertResult = {
      v: PROTOCOL_VERSION,
      type: 'insert-result',
      id: message.id,
      ok: outcome.ok,
      ...(outcome.code ? { code: outcome.code } : {}),
      ...(outcome.message ? { message: outcome.message } : {})
    }
    this.send(result)
  }

  private send(message: object): void {
    const socket = this.socket
    if (!socket || socket.readyState !== 1) return
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // The close handler will schedule a reconnect.
    }
  }

  private closeSocket(socket: SocketLike | null): void {
    if (!socket) return
    try {
      socket.close()
    } catch {
      // Ignore double-close errors.
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    const delay =
      this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ??
      10_000
    this.reconnectAttempt += 1
    this.emitStatus()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped && !this.connected) {
        void this.connect()
      }
    }, delay)
  }

  private emitStatus(): void {
    this.options.onStatus?.(this.getStatus())
  }
}

function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) return null
  try {
    const parsed = serverMessageSchema.safeParse(JSON.parse(data))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
