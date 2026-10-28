<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SettingsState } from '@shared/ipc'
import NoticeBox from '../components/NoticeBox.vue'

const props = defineProps<{ state: SettingsState }>()
const emit = defineEmits<{
  updated: [state: SettingsState]
  feedback: [message: string, kind: 'success' | 'error']
}>()

const reloading = ref(false)
const pluginErrors = computed(() =>
  props.state.runtime.errors.filter((error) => error.code === 'PLUGIN_ERROR')
)

async function reload(): Promise<void> {
  reloading.value = true
  const result = await window.api.settings.plugins.reload()
  reloading.value = false
  if (!result.ok) {
    emit('feedback', result.error.details ?? result.error.message, 'error')
    return
  }
  emit('updated', result.data)
  emit('feedback', '插件已重新加载', 'success')
}

async function openDirectory(): Promise<void> {
  const result = await window.api.settings.plugins.openDirectory()
  if (!result.ok) {
    emit('feedback', result.error.details ?? result.error.message, 'error')
  }
}
</script>

<template>
  <section id="plugins" class="card" tabindex="-1">
    <div class="card-heading">
      <div>
        <h2>插件</h2>
        <p>本地 CommonJS 插件由沙箱加载；命令冲突时静态映射优先。</p>
      </div>
      <div class="inline-actions">
        <button class="button secondary" type="button" @click="openDirectory">打开目录</button>
        <button class="button primary" type="button" :disabled="reloading" @click="reload">
          {{ reloading ? '加载中…' : '重新加载插件' }}
        </button>
      </div>
    </div>

    <p class="path-line">
      插件目录：<code>{{ props.state.pluginDirectory }}</code>
    </p>

    <NoticeBox
      v-if="pluginErrors.length > 0"
      title="插件加载错误"
      tone="danger"
      :items="
        pluginErrors.map((error) =>
          error.details ? `${error.message}：${error.details}` : error.message
        )
      "
    />

    <div v-if="props.state.plugins.length === 0" class="empty-state">
      暂无已加载插件。将 .js 文件放入插件目录后点击“重新加载插件”。
    </div>
    <div v-else class="plugin-list">
      <article v-for="plugin in props.state.plugins" :key="plugin.file" class="plugin-item">
        <div class="plugin-title">
          <strong>{{ plugin.name }}</strong>
          <code>{{ plugin.file }}</code>
        </div>
        <p v-if="plugin.error" class="field-error">{{ plugin.error }}</p>
        <div v-else class="chip-list">
          <span v-for="command in plugin.commands" :key="command" class="chip">{{ command }}</span>
        </div>
      </article>
    </div>

    <p class="hint">插件示例与接口说明位于插件目录的 README.md，以及项目的 docs/plugins.md。</p>
  </section>
</template>
