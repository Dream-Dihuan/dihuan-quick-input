<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { VIEW_META, type ViewId } from './navigation'

const props = defineProps<{
  activeView: ViewId
  mappingCount: number
  connectedCount: number
  browserLabel?: string
}>()

const emit = defineEmits<{ select: [view: ViewId] }>()

interface NavItem {
  id: ViewId
  label: string
  paths: string[]
}

const items: NavItem[] = [
  {
    id: 'mappings',
    label: VIEW_META.mappings.label,
    paths: ['M3 4.6h10', 'M3 8h10', 'M3 11.4h6']
  },
  {
    id: 'settings',
    label: VIEW_META.settings.label,
    paths: ['M3 5.4h10', 'M3 10.6h10', 'M5.6 3v4.8', 'M10.4 8.2v4.8']
  }
]

const ITEM_HEIGHT = 40
const navButtons = ref<HTMLButtonElement[]>([])
const activeIndex = computed(() => items.findIndex((item) => item.id === props.activeView))
const statusLabel = computed(() =>
  props.connectedCount > 0 ? `${props.browserLabel || '浏览器'} 已连接` : '等待浏览器连接'
)

// `import.meta.env.APP_VERSION` is injected at build time; tests fall back to "dev".
const version = import.meta.env.APP_VERSION ?? 'dev'

function select(view: ViewId): void {
  emit('select', view)
}

/** Arrow keys move the roving focus and activate the page, tablist style. */
function onNavKeydown(event: KeyboardEvent): void {
  const current = Math.max(activeIndex.value, 0)
  let next = current
  if (event.key === 'ArrowDown') next = (current + 1) % items.length
  else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else return
  event.preventDefault()
  select(items[next].id)
  void nextTick(() => navButtons.value[next]?.focus())
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-brand">
      <span class="brand-mark">⌘</span>
      <div>
        <span class="eyebrow">Dihuan</span>
        <h1>Quick Input</h1>
      </div>
    </div>

    <nav class="sidebar-nav" aria-label="主导航" @keydown="onNavKeydown">
      <span
        class="sidebar-indicator"
        :style="{ transform: `translateY(${activeIndex * ITEM_HEIGHT}px)` }"
        aria-hidden="true"
      ></span>
      <button
        v-for="item in items"
        :key="item.id"
        ref="navButtons"
        class="sidebar-item"
        :class="{ 'is-active': item.id === props.activeView }"
        :aria-current="item.id === props.activeView ? 'page' : undefined"
        type="button"
        @click="select(item.id)"
      >
        <svg class="sidebar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            v-for="(path, index) in item.paths"
            :key="index"
            :d="path"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="sidebar-label">{{ item.label }}</span>
        <span v-if="item.id === 'mappings' && props.mappingCount > 0" class="sidebar-count">
          {{ props.mappingCount }}
        </span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <span class="sidebar-status">
        <span class="sidebar-dot" :class="{ 'is-online': props.connectedCount > 0 }"></span>
        {{ statusLabel }}
      </span>
      <span class="sidebar-version">v{{ version }}</span>
    </div>
  </aside>
</template>
