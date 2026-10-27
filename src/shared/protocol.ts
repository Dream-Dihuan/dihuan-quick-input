import { z } from 'zod'
import { insertModeSchema } from './config'
import { MAX_INSERT_TEXT_LENGTH, PROTOCOL_VERSION } from './constants'

const version = z.literal(PROTOCOL_VERSION)

export const clientHelloSchema = z.object({
  v: version,
  type: z.literal('hello'),
  token: z.string().min(1).max(200),
  extensionVersion: z.string().min(1).max(64),
  browserName: z.string().min(1).max(100)
})

export const clientPongSchema = z.object({
  v: version,
  type: z.literal('pong'),
  ts: z.number().int().nonnegative()
})

export const clientPageFocusSchema = z.object({
  v: version,
  type: z.literal('page-focus'),
  ts: z.number().int().nonnegative()
})

export const clientInsertResultSchema = z.object({
  v: version,
  type: z.literal('insert-result'),
  id: z.string().min(1),
  ok: z.boolean(),
  code: z.string().max(64).optional(),
  message: z.string().max(500).optional()
})

export const clientMessageSchema = z.discriminatedUnion('type', [
  clientHelloSchema,
  clientPongSchema,
  clientPageFocusSchema,
  clientInsertResultSchema
])
export type ClientMessage = z.infer<typeof clientMessageSchema>
export type ClientHello = z.infer<typeof clientHelloSchema>
export type ClientInsertResult = z.infer<typeof clientInsertResultSchema>

export const serverWelcomeSchema = z.object({
  v: version,
  type: z.literal('welcome'),
  appVersion: z.string(),
  heartbeatMs: z.number().int().positive()
})

export const serverPingSchema = z.object({
  v: version,
  type: z.literal('ping'),
  ts: z.number().int().nonnegative()
})

export const serverInsertSchema = z.object({
  v: version,
  type: z.literal('insert'),
  id: z.string().min(1),
  text: z.string().min(1).max(MAX_INSERT_TEXT_LENGTH),
  mode: insertModeSchema
})

export const serverErrorSchema = z.object({
  v: version,
  type: z.literal('error'),
  code: z.string(),
  message: z.string()
})

export const serverMessageSchema = z.discriminatedUnion('type', [
  serverWelcomeSchema,
  serverPingSchema,
  serverInsertSchema,
  serverErrorSchema
])
export type ServerMessage = z.infer<typeof serverMessageSchema>
export type ServerInsert = z.infer<typeof serverInsertSchema>
