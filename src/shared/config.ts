import { z } from 'zod'
import { DEFAULT_HOTKEY, DEFAULT_INSERT_MODE } from './constants'

export const insertModeSchema = z.enum(['caret', 'replace'])
export type InsertMode = z.infer<typeof insertModeSchema>

export const aliasCommandSchema = z
  .string()
  .min(1, '命令名不能为空')
  .max(64, '命令名不能超过 64 个字符')
  .refine((value) => !/\s/.test(value), '命令名不能包含空白')
  .refine((value) => value.trim() === value, '命令名不能以空白开头或结尾')

export const aliasValueSchema = z
  .string()
  .min(1, '映射文本不能为空')
  .max(10_000, '映射文本不能超过 10,000 个字符')
  .refine((value) => value.trim().length > 0, '映射文本不能只包含空白')

export const aliasSchema = z.object({
  id: z.string().min(1),
  command: aliasCommandSchema,
  value: aliasValueSchema,
  enabled: z.boolean()
})
export type Alias = z.infer<typeof aliasSchema>

export const appConfigSchema = z
  .object({
    version: z.literal(1),
    onboardingComplete: z.boolean(),
    hotkey: z.string().min(1),
    insertMode: insertModeSchema,
    launchAtLogin: z.boolean(),
    server: z.object({
      token: z.string().min(16)
    }),
    aliases: z.array(aliasSchema),
    plugins: z.object({
      enabled: z.boolean()
    })
  })
  .superRefine((config, context) => {
    const seen = new Set<string>()
    for (const [index, alias] of config.aliases.entries()) {
      const normalized = alias.command.toLowerCase()
      if (seen.has(normalized)) {
        context.addIssue({
          code: 'custom',
          message: '命令名不能重复（不区分大小写）',
          path: ['aliases', index, 'command']
        })
      }
      seen.add(normalized)
    }
  })
export type AppConfig = z.infer<typeof appConfigSchema>

export function createDefaultConfig(token: string): AppConfig {
  return {
    version: 1,
    onboardingComplete: false,
    hotkey: DEFAULT_HOTKEY,
    insertMode: DEFAULT_INSERT_MODE,
    launchAtLogin: false,
    server: { token },
    aliases: [],
    plugins: { enabled: true }
  }
}
