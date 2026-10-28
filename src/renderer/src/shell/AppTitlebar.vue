<script setup lang="ts">
import { computed } from 'vue'
import { detectPlatform, type Platform } from '../settings/hotkey-recorder'
import { VIEW_META, type ViewId } from './navigation'

const props = defineProps<{
  view: ViewId
  browserConnected: boolean
  browserLabel?: string
}>()

/**
 * The window is frameless on macOS/Windows, so the titlebar is drawn here.
 * Platform comes from the shell (it sets `documentElement.dataset.platform`),
 * with a direct user-agent fallback when the shell is not mounted.
 */
const platform = computed<Platform>(() => {
  const declared = document.documentElement?.dataset?.platform
  if (declared === 'darwin' || declared === 'win32' || declared === 'linux') return declared
  return detectPlatform()
})

const meta = computed(() => VIEW_META[props.view])
</script>

<template>
  <header class="app-titlebar" :class="`titlebar--${platform}`" :data-platform="platform">
    <div class="titlebar-text">
      <span class="titlebar-crumb">{{ meta.label }}</span>
      <span class="titlebar-hint">{{ meta.description }}</span>
    </div>
    <div class="titlebar-status">
      <span class="status-pill status-neutral">本地运行</span>
      <span
        class="status-pill"
        :class="browserConnected ? 'status-ok' : 'status-warn'"
        :title="browserLabel"
      >
        {{ browserConnected ? '浏览器已连接' : '等待浏览器连接' }}
      </span>
    </div>
  </header>
</template>
