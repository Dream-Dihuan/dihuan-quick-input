<script setup lang="ts">
import type { SettingsState } from '@shared/ipc'
import AliasSection from '../settings/AliasSection.vue'
import PluginSection from '../settings/PluginSection.vue'

const props = defineProps<{ state: SettingsState; active: boolean }>()

const emit = defineEmits<{
  updated: [state: SettingsState]
  refresh: []
  feedback: [message: string, kind: 'success' | 'error']
}>()
</script>

<template>
  <section id="view-mappings" class="page" :aria-hidden="!props.active" :inert="!props.active">
    <div class="page-scroll">
      <div class="page-content">
        <header class="page-heading">
          <h1>映射与脚本</h1>
          <p>命令映射优先于脚本与内置函数；脚本是插件目录中的本地 CommonJS 文件。</p>
        </header>

        <AliasSection
          :state="props.state"
          @updated="emit('updated', $event)"
          @refresh="emit('refresh')"
          @feedback="(message, kind) => emit('feedback', message, kind)"
        />

        <PluginSection
          :state="props.state"
          @updated="emit('updated', $event)"
          @feedback="(message, kind) => emit('feedback', message, kind)"
        />

        <p class="page-footnote">命令映射与脚本只保存在本机，不会上传到网络。</p>
      </div>
    </div>
  </section>
</template>
