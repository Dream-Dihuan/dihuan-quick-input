<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import NoticeBox from '../components/NoticeBox.vue'

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
  <NoticeBox v-if="error" title="此区域渲染失败" tone="danger" default-open>
    <p>{{ error }}</p>
    <p>
      <button class="button ghost" type="button" @click="retry">重新渲染</button>
    </p>
  </NoticeBox>
  <div v-else :key="attempt">
    <slot />
  </div>
</template>
