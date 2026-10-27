import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { appError, type AppErrorInfo, type ErrorCode } from '@shared/errors'
import {
  HEARTBEAT_MISS_LIMIT,
  HANDSHAKE_TIMEOUT_MS,
  INSERT_TIMEOUT_MS,
  MAX_INSERT_TEXT_LENGTH,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  SERVER_HOST,
  DEFAULT_PORTS
} from '@shared/constants'
import { clientMessageSchema, type ServerMessage } from '@shared/protocol'
import type { ConnectionInfo } from '@shared/ipc'
import type { InsertMode } from '@shared/config'

export interface ConnectionSnapshot {
  port: number | null
  connections: ConnectionInfo[]
  lastError: AppErrorInfo | null
}

export type ConnectionListener = (snapshot: ConnectionSnapshot) => void

export interface InsertSuccess {
  connectionId: string
  browserName: string
}

export interface ConnectionServerOptions {
  ports?: number[]
  heartbeatIntervalMs?: number
  insertTimeoutMs?: number
  handshakeTimeoutMs?: number
  appVersion?: string
}

interface ClientState {
  id: string
  socket: WebSocket
  authenticated: boolean
  browserName: string
  extensionVersion: string
  connectedAt: number
  lastPageFocusAt: number | null
  focusSequence: number
  missedPings: number
  handshakeTimer: NodeJS.Timeout | null
}

interface PendingInsert {
  id: string
  socket: WebSocket
  timer: NodeJS.Timeout
  resolve: (value: InsertSuccess) => void
  reject: (error: ConnectionError) => void
}

export class ConnectionError extends Error {
  readonly code: ErrorCode
  readonly details?: string

  constructor(code: ErrorCode, message: string, details?: string) {
    super(message)
    this.name = 'ConnectionError'
    this.code = code
    this.details = details
  }
}

export function isAllowedExtensionOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'chrome-extension:' && parsed.hostname.length > 0
  } catch {
    return false
  }
}

export function secureTokenEquals(received: string, expected: string): boolean {
  const receivedHash = createHash('sha256').update(received).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(receivedHash, expectedHash)
}

const ALLOWED_RESULT_CODES = new Set<ErrorCode>([
  'NO_FIELD',
  'INSERT_FAILED',
  'INVALID_PAYLOAD',
  'EXTENSION_DISCONNECTED'
])

function resultCode(value: string | undefined): ErrorCode {
  if (value && ALLOWED_RESULT_CODES.has(value as ErrorCode)) {
    return value as ErrorCode
  }
  return 'INSERT_FAILED'
}

function resultMessage(code: ErrorCode, fallback: string | undefined): string {
  if (fallback) return fallback
  switch (code) {
    case 'NO_FIELD':
      return '当前页面没有可插入的字段，请先在表单控件中聚焦'
    case 'INVALID_PAYLOAD':
      return '插入请求无效'
    case 'EXTENSION_DISCONNECTED':
      return '浏览器扩展已断开'
    default:
      return '扩展写入字段失败'
  }
}

export class ConnectionServer {
  private readonly ports: number[]
  private readonly heartbeatIntervalMs: number
  private readonly insertTimeoutMs: number
  private readonly handshakeTimeoutMs: number
  private readonly appVersion: string

  private token = ''
  private wss: WebSocketServer | null = null
  private port: number | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private readonly states = new Map<WebSocket, ClientState>()
  private readonly pending = new Map<string, PendingInsert>()
  private readonly listeners = new Set<ConnectionListener>()
  private lastError: AppErrorInfo | null = null
  private focusSequence = 0

  constructor(token: string, options: ConnectionServerOptions = {}) {
    this.token = token
    this.ports = options.ports ?? DEFAULT_PORTS
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000
    this.insertTimeoutMs = options.insertTimeoutMs ?? INSERT_TIMEOUT_MS
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
    this.appVersion = options.appVersion ?? '0.0.0'
  }

  getPort(): number | null {
    return this.port
  }

  getSnapshot(): ConnectionSnapshot {
    return {
      port: this.port,
      connections: this.getConnections(),
      lastError: this.lastError ? { ...this.lastError } : null
    }
  }

  getConnections(): ConnectionInfo[] {
    return [...this.states.values()]
      .filter((state) => state.authenticated)
      .sort((left, right) => left.connectedAt - right.connectedAt)
      .map((state) => ({
        id: state.id,
        browserName: state.browserName,
        extensionVersion: state.extensionVersion,
        connectedAt: state.connectedAt,
        lastPageFocusAt: state.lastPageFocusAt
      }))
  }

  onChanged(listener: ConnectionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setToken(token: string): void {
    if (token === this.token) return
    this.token = token
    for (const [socket, state] of this.states) {
      if (!state.authenticated) continue
      this.send(socket, {
        v: PROTOCOL_VERSION,
        type: 'error',
        code: 'UNAUTHORIZED',
        message: '配对令牌已轮换，请重新配对'
      })
      this.rejectPending(socket, 'EXTENSION_DISCONNECTED', '配对令牌已轮换')
      state.authenticated = false
      this.states.delete(socket)
      socket.close(1008, 'Pairing token rotated')
    }
    this.emitChanged()
  }

  async start(): Promise<number> {
    if (this.wss && this.port !== null) return this.port

    const failures: string[] = []
    for (const port of this.ports) {
      try {
        const wss = await this.listen(port)
        this.wss = wss
        this.port = port
        this.startHeartbeat()
        this.emitChanged()
        return port
      } catch (error) {
        failures.push(`${port}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    this.lastError = appError(
      'SERVER_ERROR',
      '无法启动本地连接服务，端口均不可用',
      failures.join('; ')
    )
    this.emitChanged()
    throw new ConnectionError(
      'SERVER_ERROR',
      '无法启动本地连接服务，端口均不可用',
      failures.join('; ')
    )
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    this.rejectAllPending('EXTENSION_DISCONNECTED', '本地连接已关闭')

    for (const state of this.states.values()) {
      if (state.handshakeTimer) clearTimeout(state.handshakeTimer)
      state.socket.terminate()
    }
    this.states.clear()

    const wss = this.wss
    this.wss = null
    this.port = null
    if (wss) {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve())
      })
    }
    this.emitChanged()
  }

  insert(text: string, mode: InsertMode): Promise<InsertSuccess> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return Promise.reject(new ConnectionError('INVALID_PAYLOAD', '插入文本不能为空'))
    }
    if (text.length > MAX_INSERT_TEXT_LENGTH) {
      return Promise.reject(new ConnectionError('INVALID_PAYLOAD', '插入文本过长'))
    }
    if (!this.wss || this.port === null) {
      return Promise.reject(new ConnectionError('SERVER_ERROR', '本地连接服务未启动'))
    }

    const authenticated = [...this.states.values()].filter(
      (state) => state.authenticated && state.socket.readyState === WebSocket.OPEN
    )
    if (authenticated.length === 0) {
      return Promise.reject(
        new ConnectionError('EXTENSION_DISCONNECTED', '浏览器扩展未连接，请先安装并配对浏览器扩展')
      )
    }

    const focused = authenticated.filter((state) => state.lastPageFocusAt !== null)
    if (focused.length === 0) {
      return Promise.reject(
        new ConnectionError('TARGET_UNKNOWN', '无法确定目标浏览器，请先在表单控件中聚焦')
      )
    }

    focused.sort((left, right) => {
      const byTime = (right.lastPageFocusAt ?? 0) - (left.lastPageFocusAt ?? 0)
      return byTime !== 0 ? byTime : right.focusSequence - left.focusSequence
    })
    const target = focused[0]
    if (!target) {
      return Promise.reject(new ConnectionError('TARGET_UNKNOWN', '无法确定目标浏览器'))
    }

    const id = randomUUID()
    return new Promise<InsertSuccess>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new ConnectionError('INSERT_TIMEOUT', '插入超时，浏览器扩展未响应'))
      }, this.insertTimeoutMs)
      timer.unref?.()

      this.pending.set(id, {
        id,
        socket: target.socket,
        timer,
        resolve,
        reject
      })

      try {
        this.send(target.socket, {
          v: PROTOCOL_VERSION,
          type: 'insert',
          id,
          text,
          mode
        })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(
          new ConnectionError(
            'EXTENSION_DISCONNECTED',
            error instanceof Error ? error.message : '无法发送插入请求'
          )
        )
      }
    })
  }

  private listen(port: number): Promise<WebSocketServer> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: SERVER_HOST,
        port,
        maxPayload: MAX_MESSAGE_BYTES,
        perMessageDeflate: false,
        verifyClient: (info, callback) => {
          const origin = info.origin || (info.req.headers.origin as string | undefined)
          if (isAllowedExtensionOrigin(origin)) {
            callback(true)
            return
          }
          this.lastError = appError('UNAUTHORIZED', '连接来源不是浏览器扩展，已拒绝连接')
          callback(false, 403, 'Forbidden')
        }
      })

      let settled = false
      const cleanup = (): void => {
        wss.removeListener('listening', onListening)
        wss.removeListener('error', onError)
      }
      const onListening = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(wss)
      }
      const onError = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        try {
          wss.close()
        } catch {
          // The server never finished listening; close is best effort.
        }
        reject(error)
      }

      wss.once('listening', onListening)
      wss.once('error', onError)
      wss.on('connection', (socket) => this.handleConnection(socket))
      wss.on('error', (error) => {
        this.lastError = appError('SERVER_ERROR', '本地连接服务错误', error.message)
        this.emitChanged()
      })
    })
  }

  private handleConnection(socket: WebSocket): void {
    const handshakeTimer = setTimeout(() => {
      const state = this.states.get(socket)
      if (!state || state.authenticated) return
      this.send(socket, {
        v: PROTOCOL_VERSION,
        type: 'error',
        code: 'UNAUTHORIZED',
        message: '连接握手超时'
      })
      socket.close(1008, 'Handshake timeout')
    }, this.handshakeTimeoutMs)
    handshakeTimer.unref?.()

    const state: ClientState = {
      id: randomUUID(),
      socket,
      authenticated: false,
      browserName: '',
      extensionVersion: '',
      connectedAt: Date.now(),
      lastPageFocusAt: null,
      focusSequence: 0,
      missedPings: 0,
      handshakeTimer
    }
    this.states.set(socket, state)

    socket.on('message', (data: RawData) => {
      this.handleMessage(state, data)
    })
    socket.on('close', () => {
      this.handleClose(state)
    })
    socket.on('error', () => {
      // A close event follows; state cleanup happens there.
    })
  }

  private handleMessage(state: ClientState, data: RawData): void {
    let raw: unknown
    try {
      const text = typeof data === 'string' ? data : data.toString()
      raw = JSON.parse(text)
    } catch {
      this.fail(state, 'INVALID_PAYLOAD', '消息不是合法 JSON')
      return
    }

    const parsed = clientMessageSchema.safeParse(raw)
    if (!parsed.success) {
      this.fail(state, 'INVALID_PAYLOAD', '消息格式无效')
      return
    }
    const message = parsed.data

    if (!state.authenticated) {
      if (message.type !== 'hello') {
        this.fail(state, 'UNAUTHORIZED', '请先完成配对握手')
        return
      }
      this.handleHello(state, message)
      return
    }

    if (message.type === 'hello') {
      this.fail(state, 'INVALID_PAYLOAD', '重复的握手消息')
      return
    }

    if (message.type === 'pong') {
      state.missedPings = 0
      return
    }

    if (message.type === 'page-focus') {
      if (state.lastPageFocusAt === null || message.ts >= state.lastPageFocusAt) {
        state.lastPageFocusAt = message.ts
        state.focusSequence = ++this.focusSequence
      }
      return
    }

    if (message.type === 'insert-result') {
      this.handleInsertResult(state, message)
    }
  }

  private handleHello(
    state: ClientState,
    message: { token: string; browserName: string; extensionVersion: string }
  ): void {
    if (state.handshakeTimer) {
      clearTimeout(state.handshakeTimer)
      state.handshakeTimer = null
    }

    if (!secureTokenEquals(message.token, this.token)) {
      this.lastError = appError('UNAUTHORIZED', '配对令牌无效，连接已被拒绝')
      this.send(state.socket, {
        v: PROTOCOL_VERSION,
        type: 'error',
        code: 'UNAUTHORIZED',
        message: '配对令牌无效'
      })
      state.socket.close(1008, 'Unauthorized')
      this.emitChanged()
      return
    }

    state.authenticated = true
    state.browserName = message.browserName
    state.extensionVersion = message.extensionVersion
    state.connectedAt = Date.now()
    state.missedPings = 0

    this.send(state.socket, {
      v: PROTOCOL_VERSION,
      type: 'welcome',
      appVersion: this.appVersion,
      heartbeatMs: this.heartbeatIntervalMs
    })
    this.emitChanged()
  }

  private handleInsertResult(
    state: ClientState,
    message: {
      id: string
      ok: boolean
      code?: string
      message?: string
    }
  ): void {
    const pending = this.pending.get(message.id)
    if (!pending || pending.socket !== state.socket) {
      // Late or mismatched results are intentionally ignored.
      return
    }

    clearTimeout(pending.timer)
    this.pending.delete(message.id)

    if (message.ok) {
      pending.resolve({
        connectionId: state.id,
        browserName: state.browserName
      })
      return
    }

    const code = resultCode(message.code)
    pending.reject(new ConnectionError(code, resultMessage(code, message.message)))
  }

  private handleClose(state: ClientState): void {
    if (state.handshakeTimer) {
      clearTimeout(state.handshakeTimer)
      state.handshakeTimer = null
    }
    this.states.delete(state.socket)
    if (state.authenticated) {
      this.rejectPending(state.socket, 'EXTENSION_DISCONNECTED', '浏览器扩展已断开')
      this.emitChanged()
    }
  }

  private fail(state: ClientState, code: ErrorCode, message: string): void {
    this.send(state.socket, {
      v: PROTOCOL_VERSION,
      type: 'error',
      code,
      message
    })
    state.socket.close(1008, message)
  }

  private rejectPending(socket: WebSocket, code: ErrorCode, message: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.socket !== socket) continue
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(new ConnectionError(code, message))
    }
  }

  private rejectAllPending(code: ErrorCode, message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(new ConnectionError(code, message))
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new ConnectionError('EXTENSION_DISCONNECTED', '连接已关闭')
    }
    socket.send(JSON.stringify(message))
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      for (const state of this.states.values()) {
        if (!state.authenticated) continue
        if (state.missedPings >= HEARTBEAT_MISS_LIMIT) {
          state.socket.terminate()
          continue
        }
        state.missedPings += 1
        try {
          this.send(state.socket, {
            v: PROTOCOL_VERSION,
            type: 'ping',
            ts: Date.now()
          })
        } catch {
          state.socket.terminate()
        }
      }
    }, this.heartbeatIntervalMs)
    this.heartbeatTimer.unref?.()
  }

  private emitChanged(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // A broken UI listener must not break the connection service.
      }
    }
  }
}
