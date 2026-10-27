<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { Alias } from '@shared/config'
import type { SettingsState } from '@shared/ipc'
import { hasAliasErrors, validateAliasDraft, type AliasDraftErrors } from './alias-validation'

const props = defineProps<{ state: SettingsState }>()
const emit = defineEmits<{
  updated: [state: SettingsState]
  refresh: []
  feedback: [message: string, kind: 'success' | 'error']
}>()

const editingId = ref<string | null>(null)
const draft = reactive({ command: '', value: '', enabled: true })
const errors = ref<AliasDraftErrors>({})
const saving = ref(false)
const formVisible = ref(false)

function startCreate(): void {
  editingId.value = null
  draft.command = ''
  draft.value = ''
  draft.enabled = true
  errors.value = {}
  formVisible.value = true
}

function startEdit(alias: Alias): void {
  editingId.value = alias.id
  draft.command = alias.command
  draft.value = alias.value
  draft.enabled = alias.enabled
  errors.value = {}
  formVisible.value = true
}

function cancelForm(): void {
  editingId.value = null
  formVisible.value = false
  errors.value = {}
}

async function save(): Promise<void> {
  errors.value = validateAliasDraft(draft, props.state.config.aliases, editingId.value)
  if (hasAliasErrors(errors.value)) return

  saving.value = true
  const result = editingId.value
    ? await window.api.settings.aliases.update({
        id: editingId.value,
        command: draft.command,
        value: draft.value,
        enabled: draft.enabled
      })
    : await window.api.settings.aliases.create({
        command: draft.command,
        value: draft.value,
        enabled: draft.enabled
      })
  saving.value = false

  if (!result.ok) {
    if (result.error.code === 'INVALID_PAYLOAD') {
      errors.value = { command: result.error.details ?? result.error.message }
    }
    emit('feedback', result.error.details ?? result.error.message, 'error')
    return
  }

  emit('feedback', editingId.value ? '命令映射已更新' : '命令映射已添加', 'success')
  cancelForm()
  emit('refresh')
}

async function toggle(alias: Alias): Promise<void> {
  const result = await window.api.settings.aliases.update({
    id: alias.id,
    enabled: !alias.enabled
  })
  if (!result.ok) {
    emit('feedback', result.error.message, 'error')
    return
  }
  emit('refresh')
}

async function remove(alias: Alias): Promise<void> {
  if (!window.confirm(`确定删除命令映射「${alias.command}」吗？`)) return
  const result = await window.api.settings.aliases.remove({ id: alias.id })
  if (!result.ok) {
    emit('feedback', result.error.message, 'error')
    return
  }
  emit('updated', result.data)
  emit('feedback', '命令映射已删除', 'success')
}
</script>

<template>
  <section id="aliases" class="card">
    <div class="card-heading">
      <div>
        <h2>命令映射</h2>
        <p>静态映射优先于插件和内置函数；命令名不区分大小写。</p>
      </div>
      <button class="button primary" type="button" @click="startCreate">新增映射</button>
    </div>

    <div v-if="props.state.conflicts.length > 0" class="warning-box">
      <strong>命令冲突</strong>
      <p v-for="conflict in props.state.conflicts" :key="conflict.command">
        <code>{{ conflict.command }}</code> 同时存在于
        {{ conflict.sources.join(' / ') }}
        <template v-if="conflict.plugins?.length">（{{ conflict.plugins.join(', ') }}）</template>
      </p>
    </div>

    <div v-if="formVisible" class="alias-form">
      <div class="form-heading">
        <h3>{{ editingId ? '编辑命令映射' : '新增命令映射' }}</h3>
        <button class="button ghost" type="button" @click="cancelForm">取消</button>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="alias-command">命令名</label>
          <input
            id="alias-command"
            v-model="draft.command"
            class="control"
            placeholder="例如 name"
            autocomplete="off"
          />
          <p v-if="errors.command" class="field-error">{{ errors.command }}</p>
          <p v-else class="hint">一个单词，不包含空白。</p>
        </div>
        <div class="field span-2">
          <label for="alias-value">映射文本</label>
          <textarea
            id="alias-value"
            v-model="draft.value"
            class="control textarea"
            rows="3"
            placeholder="按快捷键后插入的文本"
          ></textarea>
          <p v-if="errors.value" class="field-error">{{ errors.value }}</p>
        </div>
        <label class="checkbox-row field">
          <input v-model="draft.enabled" type="checkbox" />
          <span>启用此映射</span>
        </label>
      </div>
      <div class="card-actions">
        <button class="button primary" type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存映射' }}
        </button>
      </div>
    </div>

    <div v-if="props.state.config.aliases.length === 0" class="empty-state">
      还没有静态映射。添加后即可在浮层中输入命令名插入文本。
    </div>
    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>命令</th>
            <th>映射文本</th>
            <th>状态</th>
            <th class="actions-column">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alias in props.state.config.aliases" :key="alias.id">
            <td>
              <code>{{ alias.command }}</code>
            </td>
            <td class="value-cell" :title="alias.value">{{ alias.value }}</td>
            <td>
              <button
                class="toggle"
                :class="{ on: alias.enabled }"
                type="button"
                :aria-pressed="alias.enabled"
                @click="toggle(alias)"
              >
                {{ alias.enabled ? '已启用' : '已停用' }}
              </button>
            </td>
            <td class="row-actions">
              <button class="button ghost" type="button" @click="startEdit(alias)">编辑</button>
              <button class="button ghost danger-text" type="button" @click="remove(alias)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="hint builtin-hint">
      内置命令：age、date、time、uuid、upper、lower。支持参数，例如
      <code>age 19</code>、<code>upper "hello world"</code>。插件命令会出现在插件区域。
    </p>
  </section>
</template>
