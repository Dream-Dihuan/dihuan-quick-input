<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SettingsState } from '@shared/ipc'
import NoticeBox from '../components/NoticeBox.vue'
import { copyText } from './clipboard'

const props = defineProps<{ state: SettingsState }>()
const emit = defineEmits<{
  updated: [state: SettingsState]
  feedback: [message: string, kind: 'success' | 'error']
}>()

const rotating = ref(false)
const copying = ref(false)

const serverErrors = computed(() =>
  props.state.runtime.errors.filter((error) =>
    ['SERVER_ERROR', 'UNAUTHORIZED', 'CONFIG_ERROR'].includes(error.code)
  )
)

async function copyToken(): Promise<void> {
  copying.value = true
  const ok = await copyText(props.state.config.server.token)
  copying.value = false
  emit('feedback', ok ? '配对令牌已复制' : '复制失败，请手动选择令牌', ok ? 'success' : 'error')
}

async function rotate(): Promise<void> {
  if (!window.confirm('轮换令牌后，现有浏览器扩展需要重新配对。确定继续吗？')) return
  rotating.value = true
  const result = await window.api.settings.connection.rotateToken()
  rotating.value = false
  if (!result.ok) {
    emit('feedback', result.error.message, 'error')
    return
  }
  emit('updated', result.data)
  emit('feedback', '令牌已轮换，请重新配对扩展', 'success')
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}
</script>

<template>
  <section id="connection" class="card">
    <div class="card-heading">
      <div>
        <h2>浏览器扩展</h2>
        <p>扩展通过本机回环 WebSocket 与桌面应用通信，不经过网络；配对令牌只保存在本机。</p>
      </div>
      <span
        class="status-pill"
        :class="props.state.connections.length > 0 ? 'status-ok' : 'status-warn'"
      >
        {{ props.state.connections.length > 0 ? '扩展已连接' : '等待扩展连接' }}
      </span>
    </div>

    <div class="connection-grid">
      <div class="field">
        <label>监听端口</label>
        <div class="readonly-value">
          {{ props.state.runtime.port ?? '尚未启动' }}
          <span class="hint">（范围 47821–47830）</span>
        </div>
      </div>
      <div class="field span-2">
        <label>配对令牌</label>
        <div class="token-row">
          <code class="token">{{ props.state.config.server.token }}</code>
          <button class="button secondary" type="button" :disabled="copying" @click="copyToken">
            {{ copying ? '复制中…' : '复制' }}
          </button>
          <button class="button danger" type="button" :disabled="rotating" @click="rotate">
            {{ rotating ? '轮换中…' : '轮换令牌' }}
          </button>
        </div>
        <p class="hint">在扩展弹窗中粘贴此令牌即可完成配对。</p>
      </div>
    </div>

    <h3 class="subheading">已连接的扩展</h3>
    <div v-if="props.state.connections.length === 0" class="empty-state compact">
      暂无连接。请安装扩展并在弹窗中填入令牌。
    </div>
    <ul v-else class="connection-list">
      <li v-for="connection in props.state.connections" :key="connection.id">
        <span class="connection-dot"></span>
        <strong>{{ connection.browserName }}</strong>
        <span class="hint">v{{ connection.extensionVersion }}</span>
        <span class="hint">连接于 {{ formatTime(connection.connectedAt) }}</span>
      </li>
    </ul>

    <NoticeBox
      v-if="serverErrors.length > 0"
      title="最近的连接错误"
      tone="danger"
      :items="
        serverErrors.map((error) =>
          error.details ? `${error.message}：${error.details}` : error.message
        )
      "
    />
  </section>
</template>
