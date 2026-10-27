import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PluginHost,
  type PluginBundle,
  type PluginHostOptions
} from '../../../src/main/commands/plugin-host'
import { CommandError, type LoadedPlugin } from '../../../src/main/commands/types'
import { removeDirectory, temporaryPluginDirectory, writePlugin } from './helpers'

describe('plugin host', () => {
  let directory: string

  beforeEach(async () => {
    directory = await temporaryPluginDirectory()
  })

  afterEach(async () => {
    await removeDirectory(directory)
  })

  async function load(
    files: Record<string, string>,
    options: PluginHostOptions = { loadTimeoutMs: 50, executeTimeoutMs: 50 }
  ): Promise<PluginBundle> {
    for (const [file, source] of Object.entries(files)) {
      await writePlugin(directory, file, source)
    }
    return new PluginHost(directory, options).load()
  }

  function firstPlugin(bundle: PluginBundle): LoadedPlugin {
    expect(bundle.plugins).toHaveLength(1)
    return bundle.plugins[0]
  }

  function capture(run: () => unknown): CommandError {
    try {
      run()
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError)
      return error as CommandError
    }
    throw new Error('expected a CommandError')
  }

  it('loads a valid plugin with commands and metadata', async () => {
    const bundle = await load({
      'company.js': `module.exports = {
        name: 'Company Tools',
        commands: {
          zebra: () => 'z',
          company: () => '示例公司'
        }
      }`
    })

    expect(bundle.infos).toEqual([
      {
        file: 'company.js',
        name: 'Company Tools',
        commands: ['company', 'zebra']
      }
    ])
    expect(
      bundle.plugins[0]?.execute('company', [], {
        rawArgs: '',
        now: '2026-10-27T00:00:00.000Z',
        locale: 'zh-CN'
      })
    ).toBe('示例公司')
  })

  it('passes JSON arguments and context to the command', async () => {
    const plugin = firstPlugin(
      await load({
        'greet.cjs': `module.exports = {
          name: 'Greeter',
          commands: {
            greet: function (args, ctx) {
              return JSON.stringify({ args: args, ctx: ctx })
            }
          }
        }`
      })
    )

    const value = plugin.execute('greet', ['Alice Smith', '42'], {
      rawArgs: '"Alice Smith" 42',
      now: '2026-10-27T09:05:00.000Z',
      locale: 'zh-CN'
    })
    expect(JSON.parse(value)).toEqual({
      args: ['Alice Smith', '42'],
      ctx: {
        rawArgs: '"Alice Smith" 42',
        now: '2026-10-27T09:05:00.000Z',
        locale: 'zh-CN'
      }
    })
  })

  it('normalizes command names and matches them case-insensitively', async () => {
    const plugin = firstPlugin(
      await load({
        'case.js': `module.exports = {
          commands: {
            Company: () => '示例公司'
          }
        }`
      })
    )

    expect(plugin.commands).toEqual(['company'])
    expect(
      plugin.execute('company', [], {
        rawArgs: '',
        now: '2026-10-27T00:00:00.000Z',
        locale: 'zh-CN'
      })
    ).toBe('示例公司')
  })

  it('isolates a syntax error from other plugins', async () => {
    const bundle = await load({
      'bad.js': 'module.exports = {',
      'good.js': `module.exports = { commands: { good: () => 'good' } }`
    })

    expect(bundle.plugins.map((plugin) => plugin.file)).toEqual(['good.js'])
    expect(bundle.infos.find((info) => info.file === 'bad.js')?.error).toBeTruthy()
    expect(bundle.infos.find((info) => info.file === 'good.js')?.commands).toEqual(['good'])
  })

  it('returns a plugin error when a command throws', async () => {
    const plugin = firstPlugin(
      await load({
        'throw.js': `module.exports = { commands: { fail: () => { throw new Error('boom') } } }`
      })
    )
    const error = capture(() =>
      plugin.execute('fail', [], {
        rawArgs: '',
        now: '2026-10-27T00:00:00.000Z',
        locale: 'zh-CN'
      })
    )
    expect(error.code).toBe('PLUGIN_ERROR')
    expect(error.details).toContain('boom')
  })

  it('blocks require, process and Buffer access', async () => {
    const plugin = firstPlugin(
      await load({
        'blocked.js': `module.exports = {
          commands: {
            fs: () => require('fs').readFileSync('/etc/passwd', 'utf8'),
            process: () => process.version,
            buffer: () => Buffer.from('x').toString()
          }
        }`
      })
    )

    for (const command of ['fs', 'process', 'buffer']) {
      const error = capture(() =>
        plugin.execute(command, [], {
          rawArgs: '',
          now: '2026-10-27T00:00:00.000Z',
          locale: 'zh-CN'
        })
      )
      expect(error.code).toBe('PLUGIN_ERROR')
    }
  })

  it('rejects Promise results', async () => {
    const plugin = firstPlugin(
      await load({
        'async.js': `module.exports = { commands: { asyncCommand: () => Promise.resolve('x') } }`
      })
    )
    const error = capture(() =>
      plugin.execute('asyncCommand', [], {
        rawArgs: '',
        now: '2026-10-27T00:00:00.000Z',
        locale: 'zh-CN'
      })
    )
    expect(error.code).toBe('ASYNC_NOT_SUPPORTED')
  })

  it('rejects non-string and empty results', async () => {
    const plugin = firstPlugin(
      await load({
        'results.js': `module.exports = {
          commands: {
            number: () => 19,
            empty: () => '',
            object: () => ({ value: 'x' })
          }
        }`
      })
    )

    for (const command of ['number', 'empty', 'object']) {
      const error = capture(() =>
        plugin.execute(command, [], {
          rawArgs: '',
          now: '2026-10-27T00:00:00.000Z',
          locale: 'zh-CN'
        })
      )
      expect(error.code).toBe('INVALID_RESULT')
    }
  })

  it('rejects results over the configured output limit', async () => {
    const plugin = firstPlugin(
      await load(
        {
          'long.js': `module.exports = { commands: { long: () => 'x'.repeat(20) } }`
        },
        { executeTimeoutMs: 50, maxOutputLength: 10 }
      )
    )
    const error = capture(() =>
      plugin.execute('long', [], {
        rawArgs: '',
        now: '2026-10-27T00:00:00.000Z',
        locale: 'zh-CN'
      })
    )
    expect(error.code).toBe('INVALID_RESULT')
  })

  it('times out an infinite command loop', async () => {
    const plugin = firstPlugin(
      await load({
        'loop.js': `module.exports = { commands: { loop: () => { while (true) {} } } }`
      })
    )
    const error = capture(() =>
      plugin.execute('loop', [], {
        rawArgs: '',
        now: '2026-10-27T00:00:00.000Z',
        locale: 'zh-CN'
      })
    )
    expect(error.code).toBe('PLUGIN_TIMEOUT')
  })

  it('times out plugin loading', async () => {
    const bundle = await load({
      'slow.js': 'while (true) {}'
    })
    expect(bundle.plugins).toHaveLength(0)
    expect(bundle.infos[0]?.error).toContain('超时')
  })

  it('rejects malformed exports', async () => {
    const malformed = await load({
      'function.js': 'module.exports = function () {}'
    })
    expect(malformed.infos[0]?.error).toContain('对象')
  })

  it('rejects oversized plugin files', async () => {
    const oversizedDirectory = await temporaryPluginDirectory()
    try {
      await writePlugin(
        oversizedDirectory,
        'large.js',
        `module.exports = { commands: { value: () => 'x' } } // padding`
      )
      const oversized = await new PluginHost(oversizedDirectory, {
        maxFileBytes: 5
      }).load()
      expect(oversized.plugins).toHaveLength(0)
      expect(oversized.infos[0]?.file).toBe('large.js')
      expect(oversized.infos[0]?.error).toContain('1 MiB')
    } finally {
      await removeDirectory(oversizedDirectory)
    }
  })

  it('rejects commands without functions or with whitespace in their names', async () => {
    const nonFunction = await load({
      'value.js': `module.exports = { commands: { value: 'text' } }`
    })
    expect(nonFunction.infos[0]?.error).toContain('函数')

    const whitespace = await load({
      'space.js': `module.exports = { commands: { 'two words': () => 'x' } }`
    })
    expect(whitespace.infos[0]?.error).toContain('空白')
  })

  it('returns an empty bundle when the plugin directory does not exist', async () => {
    const host = new PluginHost(`${directory}/missing`)
    await expect(host.load()).resolves.toEqual({ plugins: [], infos: [] })
  })
})
