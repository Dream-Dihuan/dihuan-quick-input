<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

const error = ref<string | null>(null)
const attempt = ref(0)

onErrorCaptured((captured) => {
  error.value = captured instanceof Error ? captured.message : String(captured)
  return false
})

function retry(): void {
  error.value = null
  attempt.value += 1
}
</script>

<template>
  <div v-if="error" class="warning-box">
    <strong>此区域渲染失败</strong>
    <p>{{ error }}</p>
    <button class="button ghost" type="button" @click="retry">重新渲染</button>
  </div>
  <div v-else :key="attempt">
    <slot />
  </div>
</template>
