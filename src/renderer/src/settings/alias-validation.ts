import type { Alias } from '@shared/config'

export interface AliasDraft {
  command: string
  value: string
}

export interface AliasDraftErrors {
  command?: string
  value?: string
}

export function validateAliasDraft(
  draft: AliasDraft,
  aliases: readonly Alias[],
  editingId?: string | null
): AliasDraftErrors {
  const errors: AliasDraftErrors = {}
  const command = draft.command

  if (command.length === 0) {
    errors.command = '命令名不能为空'
  } else if (command.length > 64) {
    errors.command = '命令名不能超过 64 个字符'
  } else if (/\s/.test(command)) {
    errors.command = '命令名不能包含空白'
  } else if (command.trim() !== command) {
    errors.command = '命令名不能以空白开头或结尾'
  } else if (
    aliases.some(
      (alias) => alias.id !== editingId && alias.command.toLowerCase() === command.toLowerCase()
    )
  ) {
    errors.command = '命令名已存在（不区分大小写）'
  }

  if (draft.value.trim().length === 0) {
    errors.value = '映射文本不能为空'
  } else if (draft.value.length > 10_000) {
    errors.value = '映射文本不能超过 10,000 个字符'
  }

  return errors
}

export function hasAliasErrors(errors: AliasDraftErrors): boolean {
  return Boolean(errors.command || errors.value)
}
