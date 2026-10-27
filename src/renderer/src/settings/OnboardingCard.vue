<script setup lang="ts">
import { ref } from 'vue'
import type { SettingsState } from '@shared/ipc'
import { copyText } from './clipboard'

const props = defineProps<{ state: SettingsState }>()
const emit = defineEmits<{
  updated: [state: SettingsState]
  feedback: [message: string, kind: 'success' | 'error']
}>()

const completing = ref(false)

async function copyToken(): Promise<void> {
  const ok = await copyText(props.state.config.server.token)
  emit('feedback', ok ? '配对令牌已复制' : '复制失败，请手动选择令牌', ok ? 'success' : 'error')
}

async function openDirectory(): Promise<void> {
  const result = await window.api.settings.plugins.openDirectory()
  if (!result.ok) {
    emit('feedback', result.error.details ?? result.error.message, 'error')
  }
}

async function complete(): Promise<void> {
  completing.value = true
  const result = await window.api.settings.onboarding.complete()
  completing.value = false
  if (!result.ok) {
    emit('feedback', result.error.message, 'error')
    return
  }
  emit('updated', result.data)
  emit('feedback', '引导已完成。按全局快捷键开始使用。', 'success')
}
</script>

<template>
  <section class="onboarding">
    <div class="onboarding-head">
      <div>
        <span class="eyebrow">首次使用</span>
        <h2>完成配对，开始快速输入</h2>
        <p>桌面应用负责快捷键和命令解析，浏览器扩展负责把结果写入当前字段。</p>
      </div>
      <span class="onboarding-badge">4 个步骤</span>
    </div>

    <ol class="onboarding-steps">
      <li>
        <span class="step-number">1</span>
        <div>
          <strong>安装浏览器扩展</strong>
          <p>在 Chrome / Edge 打开扩展管理页，启用开发者模式并加载 <code>dist-extension</code>。</p>
        </div>
      </li>
      <li>
        <span class="step-number">2</span>
        <div>
          <strong>复制配对令牌</strong>
          <div class="inline-actions">
            <code class="token">{{ props.state.config.server.token }}</code>
            <button class="button secondary" type="button" @click="copyToken">复制</button>
          </div>
          <p>打开扩展弹窗，粘贴令牌并保存。连接成功后会在下方显示浏览器信息。</p>
        </div>
      </li>
      <li>
        <span class="step-number">3</span>
        <div>
          <strong>准备插件目录</strong>
          <div class="inline-actions">
            <code>{{ props.state.pluginDirectory }}</code>
            <button class="button secondary" type="button" @click="openDirectory">打开目录</button>
          </div>
          <p>可选：将本地 .js 插件放入目录，扩展更多命令。</p>
        </div>
      </li>
      <li>
        <span class="step-number">4</span>
        <div>
          <strong>设置快捷键</strong>
          <p>
            当前快捷键为 <kbd>{{ props.state.config.hotkey }}</kbd
            >。可在“常规”区域录制新的组合键。
          </p>
        </div>
      </li>
    </ol>

    <div class="card-actions">
      <button class="button primary" type="button" :disabled="completing" @click="complete">
        {{ completing ? '保存中…' : '完成引导' }}
      </button>
    </div>
  </section>
</template>
