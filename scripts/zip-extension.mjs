import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDirectory = resolve(root, 'dist-extension')
const releaseDirectory = resolve(root, 'release')
const manifestPath = resolve(extensionDirectory, 'manifest.json')

try {
  await access(manifestPath)
} catch {
  console.error('未找到 dist-extension/manifest.json，请先执行 pnpm build:extension。')
  process.exit(1)
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const version = String(manifest.version ?? '0.0.0')
await mkdir(releaseDirectory, { recursive: true })
const zipPath = resolve(releaseDirectory, `dihuan-quick-input-extension-${version}.zip`)
await rm(zipPath, { force: true })

const run = (command, args) =>
  spawnSync(command, args, {
    cwd: extensionDirectory,
    stdio: 'inherit'
  })

let result = run('zip', ['-qr', zipPath, '.'])
if (result.error?.code === 'ENOENT' && process.platform === 'win32') {
  const escapedDirectory = extensionDirectory.replace(/'/g, "''")
  const escapedZipPath = zipPath.replace(/'/g, "''")
  result = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${escapedDirectory}\\*' -DestinationPath '${escapedZipPath}' -Force`
  ])
}

if (result.error) {
  console.error(`创建扩展压缩包失败：${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`创建扩展压缩包失败（退出码 ${result.status ?? 'unknown'}）。`)
  process.exit(1)
}

console.log(`扩展压缩包已生成：${zipPath}`)
