import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PluginHost } from '../../../src/main/commands/plugin-host'
import { CommandRegistry } from '../../../src/main/commands/registry'
import { CommandResolver } from '../../../src/main/commands/resolver'
import { removeDirectory, temporaryPluginDirectory, writePlugin } from './helpers'

const PLUGIN_SOURCE = `module.exports = {
  name: 'doc-example',
  commands: {
    company: () => '示例公司',
    greet: (args, ctx) => {
      const name = args[0] || '朋友'
      return '你好，' + name + '（' + ctx.locale + '）'
    }
  }
}
`

describe('plugin documentation', () => {
  let directory: string

  beforeEach(async () => {
    directory = await temporaryPluginDirectory()
  })

  afterEach(async () => {
    await removeDirectory(directory)
  })

  it('documents the plugin contract', async () => {
    const docs = await readFile(resolve('docs/plugins.md'), 'utf8')
    expect(docs).toContain('module.exports')
    expect(docs).toContain('rawArgs: string')
    expect(docs).toContain('node:vm')
    expect(docs).toContain('1000 ms')
    expect(docs).toContain('200 ms')
    expect(docs).toContain('10,000')

    const readme = await readFile(resolve('resources/plugins/README.md'), 'utf8')
    expect(readme).toContain('module.exports')
    expect(readme).toContain('重新加载')
  })

  it('loads a plugin created according to the documentation', async () => {
    await writePlugin(directory, 'company.js', PLUGIN_SOURCE)
    const bundle = await new PluginHost(directory).load()
    const registry = new CommandRegistry()
    registry.update([], bundle.plugins)
    const resolver = new CommandResolver(registry)

    expect(resolver.resolve('company')).toMatchObject({ ok: true, text: '示例公司' })
    expect(resolver.resolve('greet 小明')).toMatchObject({
      ok: true,
      text: '你好，小明（zh-CN）'
    })
  })
})
