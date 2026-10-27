import { randomUUID as nodeRandomUUID } from 'node:crypto'
import { CommandError, type BuiltinCommand, type CommandContext } from './types'

function requireArgCount(name: string, args: string[], expected: number): void {
  if (args.length !== expected) {
    throw new CommandError(
      'INVALID_ARGS',
      expected === 0 ? `命令 ${name} 不接受参数` : `命令 ${name} 需要 ${expected} 个参数`
    )
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function localTime(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

const age: BuiltinCommand = {
  name: 'age',
  description: '将年龄数字转换为“N 岁”文案',
  execute(args) {
    requireArgCount('age', args, 1)
    if (!/^\d+$/.test(args[0])) {
      throw new CommandError('INVALID_ARGS', '年龄必须是大于等于 0 的整数')
    }
    const value = Number(args[0])
    if (!Number.isSafeInteger(value)) {
      throw new CommandError('INVALID_ARGS', '年龄数值超出可用范围')
    }
    return `${value} 岁`
  }
}

const date: BuiltinCommand = {
  name: 'date',
  description: '插入本地日期（YYYY-MM-DD）',
  execute(args, context: CommandContext) {
    requireArgCount('date', args, 0)
    return localDate(context.now)
  }
}

const time: BuiltinCommand = {
  name: 'time',
  description: '插入本地时间（HH:mm）',
  execute(args, context: CommandContext) {
    requireArgCount('time', args, 0)
    return localTime(context.now)
  }
}

const uuid: BuiltinCommand = {
  name: 'uuid',
  description: '插入一个随机 UUID',
  execute(args, context: CommandContext) {
    requireArgCount('uuid', args, 0)
    return (context.randomUUID ?? nodeRandomUUID)()
  }
}

const upper: BuiltinCommand = {
  name: 'upper',
  description: '把参数转换为大写',
  execute(args) {
    if (args.length === 0) {
      throw new CommandError('INVALID_ARGS', '命令 upper 需要至少 1 个参数')
    }
    return args.join(' ').toUpperCase()
  }
}

const lower: BuiltinCommand = {
  name: 'lower',
  description: '把参数转换为小写',
  execute(args) {
    if (args.length === 0) {
      throw new CommandError('INVALID_ARGS', '命令 lower 需要至少 1 个参数')
    }
    return args.join(' ').toLowerCase()
  }
}

export const builtinCommands: readonly BuiltinCommand[] = [age, date, time, uuid, upper, lower]

export function createBuiltinMap(
  commands: readonly BuiltinCommand[] = builtinCommands
): Map<string, BuiltinCommand> {
  return new Map(commands.map((command) => [command.name, command]))
}
