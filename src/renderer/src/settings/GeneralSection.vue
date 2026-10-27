<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { InsertMode } from '@shared/config'
import type { SettingsState } from '@shared/ipc'
import { captureAccelerator, detectPlatform } from './hotkey-recorder'

const props = defineProps<{ state: SettingsState }>()
const emit = defineEmits<{
  updated: [state: SettingsState]
  feedback: [message: string, kind: 'success' | 'error']
}>()

const hotkey = ref(props.state.config.hotkey)
const insertMode = ref<InsertMode>(props.state.config.insertMode)
const launchAtLogin = ref(props.state.config.launchAtLogin)
const recording = ref(false)
const recordingError = ref('')
const saving = ref(false)
const platform = detectPlatform()

const hotkeyError = computed(() =>
  props.state.runtime.errors.find(
    (error) => error.code === 'HOTKEY_CONFLICT' || error.code === 'HOTKEY_INVALID'
  )
)

watch(
  () => props.state.config.hotkey,
  (value) => {
    if (!saving.value) hotkey.value = value
  }
)
watch(
  () => props.state.config.insertMode,
  (value) => {
    if (!saving.value) insertMode.value = value
  }
)
watch(
  () => props.state.config.launchAtLogin,
  (value) => {
    if (!saving.value) launchAtLogin.value = value
  }
)

function startRecording(): void {
  recording.value = true
  recordingError.value = ''
}

function cancelRecording(): void {
  recording.value = false
  recordingError.value = ''
}

function onKeydown(event: KeyboardEvent): void {
  if (!recording.value) return
  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    cancelRecording()
    return
  }

  const captured = captureAccelerator(event, platform)
  if (!captured.ok) {
    recordingError.value = captured.message
    return
  }
  hotkey.value = captured.accelerator
  recording.value = false
  recordingError.value = ''
}

async function save(): Promise<void> {
  saving.value = true
  const result = await window.api.settings.updateGeneral({
    hotkey: hotkey.value,
    insertMode: insertMode.value,
    launchAtLogin: launchAtLogin.value
  })
  saving.value = false
  if (!result.ok) {
    emit('feedback', result.error.details ?? result.error.message, 'error')
    return
  }
  emit('updated', result.data)
  emit('feedback', '常规设置已保存', 'success')
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <section id="general" class="card">
    <div class="card-heading">
      <div>
        <h2>常规</h2>
        <p>设置唤起浮层的全局快捷键、插入方式与登录启动。</p>
      </div>
      <span
        class="status-pill"
        :class="props.state.runtime.hotkeyRegistered ? 'status-ok' : 'status-warn'"
      >
        {{ props.state.runtime.hotkeyRegistered ? '快捷键已生效' : '快捷键未注册' }}
      </span>
    </div>

    <div class="field-grid">
      <div class="field span-2">
        <label>全局快捷键</label>
        <div class="hotkey-row">
          <kbd class="hotkey-value">{{ hotkey }}</kbd>
          <button v-if="!recording" class="button secondary" type="button" @click="startRecording">
            录制快捷键
          </button>
          <button v-else class="button danger" type="button" @click="cancelRecording">
            取消录制
          </button>
        </div>
        <p v-if="recording" class="hint recording-hint">
          请按下新的组合键；Escape 取消。支持 CommandOrControl / Alt / Shift 与 F1–F24。
        </p>
        <p v-else class="hint">默认快捷键为 CommandOrControl+Shift+Space。</p>
        <p v-if="recordingError" class="field-error">{{ recordingError }}</p>
        <p v-if="hotkeyError" class="field-error">当前快捷键未生效：{{ hotkeyError.message }}</p>
      </div>

      <div class="field">
        <label for="insert-mode">插入方式</label>
        <select id="insert-mode" v-model="insertMode" class="control">
          <option value="caret">在光标处插入</option>
          <option value="replace">替换字段内容</option>
        </select>
        <p class="hint">
          {{
            insertMode === 'caret'
              ? '保留字段原有内容，在光标位置写入结果。'
              : '清空字段原有内容后再写入结果。'
          }}
        </p>
      </div>

      <div class="field">
        <label class="checkbox-row">
          <input v-model="launchAtLogin" type="checkbox" />
          <span>登录时启动</span>
        </label>
        <p class="hint">登录启动时默认隐藏窗口，仅在托盘运行。</p>
      </div>
    </div>

    <div class="card-actions">
      <button class="button primary" type="button" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存常规设置' }}
      </button>
    </div>
  </section>
</template>
