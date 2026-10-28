<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { InsertMode } from '@shared/config'
import type { SettingsState } from '@shared/ipc'
import { captureAccelerator, detectPlatform } from './hotkey-recorder'

const props = withDefaults(defineProps<{ state: SettingsState; active?: boolean }>(), {
  active: true
})
const emit = defineEmits<{
  updated: [state: SettingsState]
  feedback: [message: string, kind: 'success' | 'error']
}>()

const hotkey = ref(props.state.config.hotkey)
const insertMode = ref<InsertMode>(props.state.config.insertMode)
const launchAtLogin = ref(props.state.config.launchAtLogin)
const recording = ref(false)
const recordingError = ref('')
const savingHotkey = ref(false)
/** Latest value the user asked for, per auto-saved field. */
const desiredInsertMode = ref<InsertMode>(props.state.config.insertMode)
const desiredLaunchAtLogin = ref<boolean>(props.state.config.launchAtLogin)
/** Requests still queued or in flight per field. */
const inflightInsertMode = ref(0)
const inflightLaunchAtLogin = ref(0)
const platform = detectPlatform()

const hotkeyError = computed(() =>
  props.state.runtime.errors.find(
    (error) => error.code === 'HOTKEY_CONFLICT' || error.code === 'HOTKEY_INVALID'
  )
)
const hotkeyDirty = computed(() => hotkey.value !== props.state.config.hotkey)

watch(
  () => props.state.config.hotkey,
  (value) => {
    if (!savingHotkey.value) hotkey.value = value
  }
)
watch(
  () => props.state.config.insertMode,
  (value) => {
    // Never clobber a newer choice that is still being saved.
    if (inflightInsertMode.value > 0) return
    desiredInsertMode.value = value
    insertMode.value = value
  }
)
watch(
  () => props.state.config.launchAtLogin,
  (value) => {
    if (inflightLaunchAtLogin.value > 0) return
    desiredLaunchAtLogin.value = value
    launchAtLogin.value = value
  }
)

/* ------------------------------------------------------------- hotkey apply */

function startRecording(): void {
  recording.value = true
  recordingError.value = ''
}

function cancelRecording(): void {
  recording.value = false
  recordingError.value = ''
}

function onKeydown(event: KeyboardEvent): void {
  // Recording pauses while the page is hidden so other pages keep their keys.
  if (!recording.value || !props.active) return
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

async function applyHotkey(): Promise<void> {
  if (!hotkeyDirty.value || savingHotkey.value) return
  savingHotkey.value = true
  const result = await window.api.settings.updateGeneral({ hotkey: hotkey.value })
  savingHotkey.value = false
  if (!result.ok) {
    hotkey.value = props.state.config.hotkey
    emit('feedback', result.error.details ?? result.error.message, 'error')
    return
  }
  emit('updated', result.data)
  emit('feedback', '快捷键已生效', 'success')
}

/* --------------------------------------------------------- immediate saves */

/**
 * Discrete controls save on change. Requests are serialised so fast toggling
 * cannot land older responses last and overwrite the newest choice.
 */
let chain: Promise<unknown> = Promise.resolve()

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task, task)
}

function setLocal(field: 'insertMode' | 'launchAtLogin', value: InsertMode | boolean): void {
  if (field === 'insertMode') insertMode.value = value as InsertMode
  else launchAtLogin.value = value as boolean
}

function desiredValue(field: 'insertMode' | 'launchAtLogin'): InsertMode | boolean {
  return field === 'insertMode' ? desiredInsertMode.value : desiredLaunchAtLogin.value
}

function setDesired(field: 'insertMode' | 'launchAtLogin', value: InsertMode | boolean): void {
  if (field === 'insertMode') desiredInsertMode.value = value as InsertMode
  else desiredLaunchAtLogin.value = value as boolean
}

function inflightCount(field: 'insertMode' | 'launchAtLogin'): number {
  return field === 'insertMode' ? inflightInsertMode.value : inflightLaunchAtLogin.value
}

function addInflight(field: 'insertMode' | 'launchAtLogin', delta: number): void {
  if (field === 'insertMode') inflightInsertMode.value += delta
  else inflightLaunchAtLogin.value += delta
}

async function persist(
  field: 'insertMode' | 'launchAtLogin',
  attempted: InsertMode | boolean
): Promise<void> {
  const result = await window.api.settings.updateGeneral({ [field]: attempted })
  addInflight(field, -1)

  if (!result.ok) {
    // Reconcile with what the main process actually kept, unless a newer
    // choice is still queued behind this request.
    if (inflightCount(field) === 0) {
      const serverValue = props.state.config[field]
      setDesired(field, serverValue)
      setLocal(field, serverValue)
    }
    emit('feedback', result.error.details ?? result.error.message, 'error')
    return
  }
  emit('updated', result.data)
}

function schedule(field: 'insertMode' | 'launchAtLogin', attempted: InsertMode | boolean): void {
  if (attempted === desiredValue(field)) return
  setDesired(field, attempted)
  addInflight(field, 1)
  enqueue(() => persist(field, attempted))
}

function onInsertModeChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as InsertMode
  insertMode.value = value
  schedule('insertMode', value)
}

function onLaunchAtLoginChange(event: Event): void {
  const value = (event.target as HTMLInputElement).checked
  launchAtLogin.value = value
  schedule('launchAtLogin', value)
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <section id="general" class="card">
    <div class="card-heading">
      <div>
        <h2>快捷键</h2>
        <p>全局快捷键用于在任何应用中唤起输入浮层。录制后点“应用快捷键”才会生效。</p>
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
          <button
            class="button primary"
            type="button"
            :disabled="!hotkeyDirty || savingHotkey"
            @click="applyHotkey"
          >
            {{ savingHotkey ? '应用中…' : '应用快捷键' }}
          </button>
        </div>
        <p v-if="recording" class="hint recording-hint">
          请按下新的组合键；Escape 取消。支持 CommandOrControl / Alt / Shift 与 F1–F24。
        </p>
        <p v-else class="hint">默认快捷键为 CommandOrControl+Shift+Space。</p>
        <p v-if="recordingError" class="field-error">{{ recordingError }}</p>
        <p v-if="hotkeyError" class="field-error">当前快捷键未生效：{{ hotkeyError.message }}</p>
      </div>
    </div>

    <h3 class="subheading">输入与启动</h3>

    <div class="field-grid">
      <div class="field">
        <label for="insert-mode">插入方式</label>
        <select id="insert-mode" v-model="insertMode" class="control" @change="onInsertModeChange">
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
          <input v-model="launchAtLogin" type="checkbox" @change="onLaunchAtLoginChange" />
          <span>登录时启动</span>
        </label>
        <p class="hint">登录启动时默认隐藏窗口，仅在托盘运行。修改后立即保存。</p>
      </div>
    </div>
  </section>
</template>
