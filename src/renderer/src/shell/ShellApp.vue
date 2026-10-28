<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SettingsState } from '@shared/ipc'
import { detectPlatform } from '../settings/hotkey-recorder'
import { normalizeSettingsState } from '../settings/normalize-state'
import MappingsView from '../views/MappingsView.vue'
import SettingsView from '../views/SettingsView.vue'
import AppSidebar from './AppSidebar.vue'
import AppTitlebar from './AppTitlebar.vue'
import {
  readStoredView,
  resolveInitialView,
  storeView,
  viewDirection,
  type ViewDirection,
  type ViewId
} from './navigation'

type FeedbackKind = 'success' | 'error'

const platform = detectPlatform()
if (typeof document !== 'undefined') {
  document.documentElement.dataset.platform = platform
}

const state = ref<SettingsState | null>(null)
const loading = ref(true)
const loadError = ref('')
const feedback = ref<{ message: string; kind: FeedbackKind } | null>(null)
const activeView = ref<ViewId>('mappings')
const direction = ref<ViewDirection>(0)
const viewResolved = ref(false)

let feedbackTimer: number | undefined
let unsubscribers: Array<() => void> = []

const mappingCount = computed(() => state.value?.config.aliases.length ?? 0)
const connectedCount = computed(() => state.value?.connections.length ?? 0)
const browserLabel = computed(() => state.value?.connections[0]?.browserName)

function showFeedback(message: string, kind: FeedbackKind): void {
  feedback.value = { message, kind }
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
  feedbackTimer = window.setTimeout(() => {
    feedback.value = null
    feedbackTimer = undefined
  }, 5_000)
}

function resolveViewOnce(next: SettingsState): void {
  if (viewResolved.value) return
  activeView.value = resolveInitialView({
    onboardingComplete: next.config.onboardingComplete,
    storedView: readStoredView()
  })
  direction.value = 0
  viewResolved.value = true
}

function applyState(next: SettingsState): void {
  const normalized = normalizeSettingsState(next)
  if (!normalized) return
  state.value = normalized
  loadError.value = ''
  resolveViewOnce(normalized)
}

async function refresh(): Promise<void> {
  try {
    const result = await window.api.settings.getState()
    if (!result.ok) {
      const message = result.error.details ?? result.error.message
      if (state.value) showFeedback(message, 'error')
      else loadError.value = message
      return
    }
    const normalized = normalizeSettingsState(result.data)
    if (!normalized) {
      loadError.value = '设置数据格式无法识别，请重启应用'
      return
    }
    loadError.value = ''
    applyState(normalized)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (state.value) showFeedback(message, 'error')
    else loadError.value = message
  }
}

async function load(): Promise<void> {
  loading.value = true
  await refresh()
  loading.value = false
}

function switchTo(view: ViewId, focus?: 'plugins'): void {
  if (view === activeView.value) {
    if (focus === 'plugins') void revealPlugins()
    return
  }
  direction.value = viewDirection(activeView.value, view)
  activeView.value = view
  storeView(view)
  if (focus === 'plugins') void revealPlugins()
}

async function revealPlugins(): Promise<void> {
  await nextTick()
  const section = document.getElementById('plugins')
  if (!section) return
  if (typeof section.scrollIntoView === 'function') section.scrollIntoView({ block: 'start' })
  section.focus()
}

function onNavigate(view: ViewId, focus?: 'plugins'): void {
  switchTo(view, focus)
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return element.isContentEditable === true
}

function onKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
  if (event.key !== '1' && event.key !== '2') return
  if (isEditableTarget(event.target)) return
  if (document.querySelector('dialog[open]')) return
  event.preventDefault()
  switchTo(event.key === '1' ? 'mappings' : 'settings')
}

function subscribeShellView(): () => void {
  return window.api.events.onShellView((request) => {
    if (request?.view) switchTo(request.view)
  })
}

onMounted(async () => {
  unsubscribers = [
    window.api.events.onSettingsState(applyState),
    window.api.events.onAppError((error) => {
      showFeedback(error.details ? `${error.message}：${error.details}` : error.message, 'error')
    }),
    subscribeShellView()
  ]
  window.addEventListener('keydown', onKeydown)
  await load()
})

onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
  window.removeEventListener('keydown', onKeydown)
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
})
</script>

<template>
  <div class="app-shell">
    <AppTitlebar
      :view="activeView"
      :browser-connected="connectedCount > 0"
      :browser-label="browserLabel"
    />

    <div class="app-body">
      <AppSidebar
        :active-view="activeView"
        :mapping-count="mappingCount"
        :connected-count="connectedCount"
        :browser-label="browserLabel"
        @select="switchTo"
      />

      <main class="page-stack" :data-direction="direction === -1 ? 'back' : 'forward'">
        <div v-if="loading" class="page page--active">
          <div class="page-scroll">
            <div class="page-content">
              <div class="loading-panel">正在读取设置…</div>
            </div>
          </div>
        </div>

        <div v-else-if="!state" class="page page--active">
          <div class="page-scroll">
            <div class="page-content">
              <div class="loading-panel error-panel">
                <strong>设置加载失败</strong>
                <p>{{ loadError || '未知错误' }}</p>
                <button class="button primary" type="button" @click="load">重试</button>
              </div>
            </div>
          </div>
        </div>

        <template v-else>
          <MappingsView
            :state="state"
            :active="activeView === 'mappings'"
            :class="{ 'page--active': activeView === 'mappings' }"
            @updated="applyState"
            @refresh="refresh"
            @feedback="showFeedback"
          />
          <SettingsView
            :state="state"
            :active="activeView === 'settings'"
            :class="{ 'page--active': activeView === 'settings' }"
            @updated="applyState"
            @feedback="showFeedback"
            @navigate="onNavigate"
          />
        </template>
      </main>
    </div>

    <div v-if="feedback" class="toast" :class="`toast-${feedback.kind}`" role="status">
      {{ feedback.message }}
    </div>
  </div>
</template>
