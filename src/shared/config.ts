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

export const folderNameSchema = z
  .string()
  .min(1, '文件夹名称不能为空')
  .max(128, '文件夹名称不能超过 128 个字符')
  .refine((value) => value.trim().length > 0, '文件夹名称不能只包含空白')
  .refine((value) => value.trim() === value, '文件夹名称不能以空白开头或结尾')

export const folderSchema = z.object({
  id: z.string().min(1),
  name: folderNameSchema,
  parentId: z.string().min(1).nullable()
})
export type Folder = z.infer<typeof folderSchema>

export const aliasSchema = z.object({
  id: z.string().min(1),
  command: aliasCommandSchema,
  value: aliasValueSchema,
  enabled: z.boolean(),
  folderId: z.string().min(1).nullable().default(null)
})
export type Alias = z.infer<typeof aliasSchema>

export const appConfigSchema = z
  .object({
    version: z.literal(2),
    onboardingComplete: z.boolean(),
    hotkey: z.string().min(1),
    insertMode: insertModeSchema,
    launchAtLogin: z.boolean(),
    server: z.object({
      token: z.string().min(16)
    }),
    aliases: z.array(aliasSchema),
    folders: z.array(folderSchema),
    plugins: z.object({
      enabled: z.boolean()
    })
  })
  .superRefine((config, context) => {
    const seen = new Set<string>()
    const folderIds = new Set<string>()
    const siblingNames = new Set<string>()
    for (const [index, folder] of config.folders.entries()) {
      if (folderIds.has(folder.id)) {
        context.addIssue({
          code: 'custom',
          message: '文件夹 id 不能重复',
          path: ['folders', index, 'id']
        })
      }
      folderIds.add(folder.id)
      const key = `${folder.parentId ?? 'root'}:${folder.name.toLowerCase()}`
      if (siblingNames.has(key)) {
        context.addIssue({
          code: 'custom',
          message: '同级文件夹名称不能重复',
          path: ['folders', index, 'name']
        })
      }
      siblingNames.add(key)
    }
    for (const [index, folder] of config.folders.entries()) {
      if (folder.parentId !== null && !folderIds.has(folder.parentId)) {
        context.addIssue({
          code: 'custom',
          message: '文件夹父节点不存在',
          path: ['folders', index, 'parentId']
        })
      }
      const visited = new Set<string>([folder.id])
      let parentId = folder.parentId
      while (parentId) {
        if (visited.has(parentId)) {
          context.addIssue({
            code: 'custom',
            message: '文件夹层级不能形成循环',
            path: ['folders', index, 'parentId']
          })
          break
        }
        visited.add(parentId)
        parentId = config.folders.find((candidate) => candidate.id === parentId)?.parentId ?? null
      }
    }
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
    version: 2,
    onboardingComplete: false,
    hotkey: DEFAULT_HOTKEY,
    insertMode: DEFAULT_INSERT_MODE,
    launchAtLogin: false,
    server: { token },
    aliases: [],
    folders: [],
    plugins: { enabled: true }
  }
}
