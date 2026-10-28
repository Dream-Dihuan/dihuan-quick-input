import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const sharedAlias = {
  '@shared': resolve('src/shared')
}

export default defineConfig({
  main: {
    resolve: {
      alias: sharedAlias
    }
  },
  preload: {
    resolve: {
      alias: sharedAlias
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...sharedAlias
      }
    },
    plugins: [vue()],
    define: {
      'import.meta.env.APP_VERSION': JSON.stringify(version)
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html')
        }
      }
    }
  }
})
