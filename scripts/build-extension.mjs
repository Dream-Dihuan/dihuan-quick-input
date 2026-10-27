import { build, context } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { watch } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = resolve(root, 'dist-extension')
const watchMode = process.argv.includes('--watch')

const shared = {
  bundle: true,
  sourcemap: true,
  target: 'chrome116',
  logLevel: 'info',
  alias: {
    '@shared': resolve(root, 'src/shared')
  }
}

const builds = [
  {
    ...shared,
    entryPoints: [resolve(root, 'extension/src/background.ts')],
    outfile: resolve(outdir, 'background.js'),
    format: 'esm'
  },
  {
    ...shared,
    entryPoints: [resolve(root, 'extension/src/content.ts')],
    outfile: resolve(outdir, 'content.js'),
    format: 'iife'
  },
  {
    ...shared,
    entryPoints: [resolve(root, 'extension/src/popup.ts')],
    outfile: resolve(outdir, 'popup.js'),
    format: 'iife'
  }
]

async function copyStatic() {
  await mkdir(resolve(outdir, 'icons'), { recursive: true })
  await Promise.all([
    cp(resolve(root, 'extension/manifest.json'), resolve(outdir, 'manifest.json')),
    cp(resolve(root, 'extension/popup.html'), resolve(outdir, 'popup.html')),
    cp(resolve(root, 'extension/popup.css'), resolve(outdir, 'popup.css')),
    cp(resolve(root, 'extension/icons'), resolve(outdir, 'icons'), { recursive: true })
  ])
}

async function main() {
  if (!watchMode) {
    await rm(outdir, { recursive: true, force: true })
  }
  await mkdir(outdir, { recursive: true })
  await copyStatic()

  if (watchMode) {
    const contexts = await Promise.all(builds.map((options) => context(options)))
    await Promise.all(contexts.map((ctx) => ctx.watch()))
    watch(resolve(root, 'extension'), { recursive: true }, (_event, filename) => {
      if (!filename || filename.startsWith('src/')) return
      void copyStatic()
    })
    console.info(`Watching extension sources → ${outdir}`)
    return
  }

  await Promise.all(builds.map((options) => build(options)))
  console.info(`Extension built → ${outdir}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
