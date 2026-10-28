<script setup lang="ts">
import type { SettingsState } from '@shared/ipc'
import NoticeBox from '../components/NoticeBox.vue'
import ConnectionSection from '../settings/ConnectionSection.vue'
import GeneralSection from '../settings/GeneralSection.vue'
import OnboardingCard from '../settings/OnboardingCard.vue'
import type { ViewId } from '../shell/navigation'

const props = defineProps<{ state: SettingsState; active: boolean }>()

const emit = defineEmits<{
  updated: [state: SettingsState]
  feedback: [message: string, kind: 'success' | 'error']
  navigate: [view: ViewId, focus?: 'plugins']
}>()
</script>

<template>
  <section id="view-settings" class="page" :aria-hidden="!props.active" :inert="!props.active">
    <div class="page-scroll">
      <div class="page-content">
        <header class="page-heading">
          <h1>设置</h1>
          <p>快捷键、插入方式与浏览器扩展配对，全部保存在本机。</p>
        </header>

        <NoticeBox
          v-if="
            props.state.runtime.configRecovered || props.state.runtime.configWarnings.length > 0
          "
          title="配置文件已恢复或部分字段被忽略"
          :items="props.state.runtime.configWarnings"
        >
          <p v-if="props.state.runtime.configBackupPath">
            原文件已备份到 <code>{{ props.state.runtime.configBackupPath }}</code>
          </p>
        </NoticeBox>

        <OnboardingCard
          v-if="!props.state.config.onboardingComplete"
          :state="props.state"
          @updated="emit('updated', $event)"
          @feedback="(message, kind) => emit('feedback', message, kind)"
          @navigate="(view, focus) => emit('navigate', view, focus)"
        />

        <GeneralSection
          :state="props.state"
          :active="props.active"
          @updated="emit('updated', $event)"
          @feedback="(message, kind) => emit('feedback', message, kind)"
        />

        <ConnectionSection
          :state="props.state"
          @updated="emit('updated', $event)"
          @feedback="(message, kind) => emit('feedback', message, kind)"
        />

        <p class="page-footnote">关闭窗口后应用仍在托盘运行，全局快捷键随时可用。</p>
      </div>
    </div>
  </section>
</template>
