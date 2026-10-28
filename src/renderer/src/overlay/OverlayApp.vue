<script setup lang="ts">
import { onMounted, onUnmounted, ref, nextTick } from 'vue'

const input = ref('')
const errorMessage = ref('')
const submitting = ref(false)
const inputElement = ref<HTMLInputElement | null>(null)
const entering = ref(true)
let composing = false

const api = window.api

async function focusInput(): Promise<void> {
  await nextTick()
  inputElement.value?.focus()
}

async function playEntrance(): Promise<void> {
  // Removing and re-adding the class restarts the CSS entrance animation, so
  // every open of the overlay gets the same motion the settings shell uses.
  entering.value = false
  await nextTick()
  entering.value = true
}

function reset(): void {
  input.value = ''
  errorMessage.value = ''
  submitting.value = false
  composing = false
  void playEntrance()
  void focusInput()
}

function close(): void {
  void api.overlay.close()
}

async function submit(): Promise<void> {
  if (composing || submitting.value) return
  const text = input.value.trim()
  if (!text) {
    errorMessage.value = ''
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    const result = await api.overlay.submit({ text })
    if (!result.ok) {
      errorMessage.value = result.error.details ?? result.error.message
      void focusInput()
      return
    }
    if (!result.data.ok) {
      errorMessage.value = result.data.message ?? '插入失败'
      void focusInput()
      return
    }
    input.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交失败'
    void focusInput()
  } finally {
    submitting.value = false
  }
}

function onCompositionStart(): void {
  composing = true
}

function onCompositionEnd(): void {
  composing = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229) {
    event.preventDefault()
    void submit()
  }
}

let unsubscribeOpen: (() => void) | undefined
let unsubscribeResult: (() => void) | undefined

onMounted(() => {
  unsubscribeOpen = api.overlay.onOpen(() => reset())
  unsubscribeResult = api.overlay.onResult((result) => {
    if (!result.ok) {
      errorMessage.value = result.message ?? '插入失败'
      submitting.value = false
      void focusInput()
    } else {
      errorMessage.value = ''
    }
  })
  void focusInput()
})

onUnmounted(() => {
  unsubscribeOpen?.()
  unsubscribeResult?.()
})
</script>

<template>
  <div class="overlay-panel" :class="{ 'is-entering': entering }">
    <div class="overlay-icon">⌘</div>
    <input
      ref="inputElement"
      v-model="input"
      class="overlay-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder="输入命令，例如 name 或 age 19"
      :disabled="submitting"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @keydown="onKeydown"
    />
    <div v-if="errorMessage" class="overlay-error" role="alert">{{ errorMessage }}</div>
  </div>
</template>
