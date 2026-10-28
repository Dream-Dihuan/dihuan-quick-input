<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SettingsState } from '@shared/ipc'
import AliasSection from './AliasSection.vue'
import ConnectionSection from './ConnectionSection.vue'
import GeneralSection from './GeneralSection.vue'
import OnboardingCard from './OnboardingCard.vue'
import PluginSection from './PluginSection.vue'
import SectionBoundary from './SectionBoundary.vue'
import { normalizeSettingsState } from './normalize-state'

type FeedbackKind = 'success' | 'error'

const state = ref<SettingsState | null>(null)
const loading = ref(true)
const loadError = ref('')
const feedback = ref<{ message: string; kind: FeedbackKind } | null>(null)
let feedbackTimer: number | undefined
let unsubscribers: Array<() => void> = []

function showFeedback(message: string, kind: FeedbackKind): void {
  feedback.value = { message, kind }
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
  feedbackTimer = window.setTimeout(() => {
    feedback.value = null
    feedbackTimer = undefined
  }, 5_000)
}

async function refresh(): Promise<void> {
  try {
    const result = await window.api.settings.getState()
    if (!result.ok) {
      loadError.value = result.error.details ?? result.error.message
      return
    }
    const normalized = normalizeSettingsState(result.data)
    if (!normalized) {
      loadError.value = '设置数据格式无法识别，请重启应用'
      return
    }
    loadError.value = ''
    state.value = normalized
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
  }
}

async function load(): Promise<void> {
  loading.value = true
  await refresh()
  loading.value = false
}

function applyState(next: SettingsState): void {
  const normalized = normalizeSettingsState(next)
  if (!normalized) return
  state.value = normalized
  loadError.value = ''
}

onMounted(async () => {
  unsubscribers = [
    window.api.events.onSettingsState(applyState),
    window.api.events.onAppError((error) => {
      showFeedback(error.details ? `${error.message}：${error.details}` : error.message, 'error')
    })
  ]
  await load()
})

onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
})
</script>

<template>
  <div class="settings-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">⌘</span>
        <div>
          <span class="eyebrow">Dihuan</span>
          <h1>Quick Input</h1>
        </div>
      </div>
      <div class="header-status">
        <span class="status-pill status-neutral">本地运行</span>
        <span
          v-if="state"
          class="status-pill"
          :class="state.connections.length > 0 ? 'status-ok' : 'status-warn'"
        >
          {{ state.connections.length > 0 ? '浏览器已连接' : '等待浏览器连接' }}
        </span>
      </div>
    </header>

    <nav v-if="state" class="section-nav">
      <a href="#general">常规</a>
      <a href="#aliases">命令映射</a>
      <a href="#plugins">插件</a>
      <a href="#connection">浏览器连接</a>
    </nav>

    <main class="settings-content">
      <div v-if="loading" class="loading-panel">正在读取设置…</div>
      <div v-else-if="!state" class="loading-panel error-panel">
        <strong>设置加载失败</strong>
        <p>{{ loadError || '未知错误' }}</p>
        <button class="button primary" type="button" @click="load">重试</button>
      </div>
      <template v-else>
        <div v-if="loadError" class="warning-box">
          <strong>设置刷新失败</strong>
          <p>{{ loadError }}</p>
        </div>

        <div
          v-if="state.runtime.configRecovered || state.runtime.configWarnings.length > 0"
          class="warning-box"
        >
          <strong>配置文件已恢复或部分字段被忽略</strong>
          <p v-for="warning in state.runtime.configWarnings" :key="warning">
            {{ warning }}
          </p>
          <p v-if="state.runtime.configBackupPath">
            原文件已备份到 <code>{{ state.runtime.configBackupPath }}</code>
          </p>
        </div>

        <OnboardingCard
          v-if="!state.config.onboardingComplete"
          :state="state"
          @updated="applyState"
          @feedback="showFeedback"
        />

        <GeneralSection :state="state" @updated="applyState" @feedback="showFeedback" />
        <SectionBoundary>
          <AliasSection
            :state="state"
            @updated="applyState"
            @refresh="refresh"
            @feedback="showFeedback"
          />
        </SectionBoundary>
        <PluginSection :state="state" @updated="applyState" @feedback="showFeedback" />
        <ConnectionSection :state="state" @updated="applyState" @feedback="showFeedback" />
      </template>
    </main>

    <footer class="app-footer">
      命令、插件与配对令牌只保存在本机。关闭窗口后应用仍在托盘运行。
    </footer>

    <div v-if="feedback" class="toast" :class="`toast-${feedback.kind}`">
      {{ feedback.message }}
    </div>
  </div>
</template>
