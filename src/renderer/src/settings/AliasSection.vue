<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Alias, Folder } from '@shared/config'
import type { SettingsState } from '@shared/ipc'
import { hasAliasErrors, validateAliasDraft, type AliasDraftErrors } from './alias-validation'
import {
  buildFolderTreeRows,
  canMoveFolder,
  folderPath,
  nextFolderName,
  type FolderTreeRow
} from './folder-tree'

const props = defineProps<{ state: SettingsState }>()
const emit = defineEmits<{
  updated: [state: SettingsState]
  refresh: []
  feedback: [message: string, kind: 'success' | 'error']
}>()

type DragSource = { kind: 'folder'; id: string } | { kind: 'alias'; id: string }
type MenuTarget = { kind: 'root' } | { kind: 'folder'; id: string } | { kind: 'alias'; id: string }
interface MenuItem {
  label: string
  run: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface FoldersApi {
  create: typeof window.api.settings.folders.create
  update: typeof window.api.settings.folders.update
  remove: typeof window.api.settings.folders.remove
}

const editingId = ref<string | null>(null)
const draft = reactive({ command: '', value: '', enabled: true, folderId: null as string | null })
const errors = ref<AliasDraftErrors>({})
const saving = ref(false)
const formVisible = ref(false)

const selectedFolderId = ref<string | null>(null)
const expandedFolders = ref(new Set<string>())
const renaming = ref<{ id: string; draft: string } | null>(null)

const dragSource = ref<DragSource | null>(null)
const dropTarget = ref<string | null>(null)
const cut = ref<DragSource | null>(null)
const menu = ref<{ x: number; y: number; target: MenuTarget } | null>(null)
const menuElement = ref<HTMLElement | null>(null)
const dialogElement = ref<HTMLDialogElement | null>(null)

const vFocus = {
  mounted(element: HTMLInputElement): void {
    element.focus()
    element.select()
  }
}

function folders(): Folder[] {
  return Array.isArray(props.state.folders) ? props.state.folders : []
}
function aliases(): Alias[] {
  return Array.isArray(props.state.config?.aliases) ? props.state.config.aliases : []
}
function conflicts(): SettingsState['conflicts'] {
  return Array.isArray(props.state.conflicts) ? props.state.conflicts : []
}
function foldersApi(): FoldersApi | undefined {
  const api = (window as unknown as { api?: { settings?: { folders?: FoldersApi } } }).api
  return api?.settings?.folders
}

const rows = computed<FolderTreeRow[]>(() =>
  buildFolderTreeRows(folders(), aliases(), expandedFolders.value)
)

function feedback(message: string, kind: 'success' | 'error'): void {
  emit('feedback', message, kind)
}

function fail(result: { error?: { message: string; details?: string } }): void {
  feedback(result.error?.details ?? result.error?.message ?? '操作失败', 'error')
}

function expand(folderId: string | null): void {
  if (!folderId || expandedFolders.value.has(folderId)) return
  const next = new Set(expandedFolders.value)
  next.add(folderId)
  expandedFolders.value = next
}

function onRowClick(row: FolderTreeRow): void {
  if (row.kind !== 'folder') return
  selectedFolderId.value = row.id
  toggleFolder(row.id)
}

function toggleFolder(folderId: string): void {
  const next = new Set(expandedFolders.value)
  if (next.has(folderId)) next.delete(folderId)
  else next.add(folderId)
  expandedFolders.value = next
}

function isCut(row: FolderTreeRow): boolean {
  return cut.value?.kind === row.kind && cut.value?.id === row.id
}

function cutLabel(): string {
  const source = cut.value
  if (!source) return ''
  if (source.kind === 'folder') {
    return folders().find((folder) => folder.id === source.id)?.name ?? '文件夹'
  }
  return aliases().find((alias) => alias.id === source.id)?.command ?? '映射'
}

/* ---------------------------------------------------------------- mutations */

async function moveAlias(aliasId: string, folderId: string | null): Promise<void> {
  const alias = aliases().find((item) => item.id === aliasId)
  if (!alias || (alias.folderId ?? null) === folderId) return
  const result = await window.api.settings.aliases.update({ id: aliasId, folderId })
  if (!result.ok) return fail(result)
  expand(folderId)
  emit('refresh')
  feedback(`已移动「${alias.command}」到 ${folderPath(folders(), folderId)}`, 'success')
}

async function moveFolder(folderId: string, parentId: string | null): Promise<void> {
  if (!canMoveFolder(folders(), folderId, parentId)) {
    feedback('不能把文件夹移动到自身或它的子文件夹里', 'error')
    return
  }
  const folder = folders().find((item) => item.id === folderId)
  if (!folder || (folder.parentId ?? null) === parentId) return
  const api = foldersApi()
  if (!api) return feedback('文件夹功能需要重启应用后生效', 'error')
  const result = await api.update({ id: folderId, parentId })
  if (!result.ok) return fail(result)
  expand(parentId)
  emit('refresh')
  feedback(`已将「${folder.name}」移动到 ${folderPath(folders(), parentId)}`, 'success')
}

async function createFolderIn(parentId: string | null): Promise<void> {
  const api = foldersApi()
  if (!api) return feedback('文件夹功能需要重启应用后生效', 'error')
  const name = nextFolderName(folders(), parentId)
  const result = await api.create({ name, parentId })
  if (!result.ok) return fail(result)
  expand(parentId)
  selectedFolderId.value = parentId
  emit('refresh')
  renaming.value = { id: result.data.id, draft: name }
  focusRename()
}

function focusRename(): void {
  void nextTick(() => {
    const input = document.getElementById('tree-rename-input') as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}

function startRename(folderId: string): void {
  const folder = folders().find((item) => item.id === folderId)
  if (!folder) return
  renaming.value = { id: folderId, draft: folder.name }
  focusRename()
}

function cancelRename(): void {
  renaming.value = null
}

async function commitRename(): Promise<void> {
  const target = renaming.value
  if (!target) return
  renaming.value = null
  const name = target.draft.trim()
  const folder = folders().find((item) => item.id === target.id)
  if (!name || !folder || folder.name === name) return
  const api = foldersApi()
  if (!api) return feedback('文件夹功能需要重启应用后生效', 'error')
  const result = await api.update({ id: target.id, name })
  if (!result.ok) return fail(result)
  emit('refresh')
}

async function removeFolder(folderId: string): Promise<void> {
  const api = foldersApi()
  if (!api) return feedback('文件夹功能需要重启应用后生效', 'error')
  const folder = folders().find((item) => item.id === folderId)
  const confirmed = window.confirm(
    `删除文件夹「${folder?.name ?? ''}」？其中的映射和子文件夹会移动到上一级。`
  )
  if (!confirmed) return
  const result = await api.remove({ id: folderId, moveContents: true })
  if (!result.ok) return fail(result)
  if (selectedFolderId.value === folderId) selectedFolderId.value = null
  if (cut.value?.kind === 'folder' && cut.value.id === folderId) cut.value = null
  emit('refresh')
  feedback('文件夹已删除，内容已移到上一级', 'success')
}

async function removeAlias(alias: Alias): Promise<void> {
  if (!window.confirm(`确定删除命令映射「${alias.command}」吗？`)) return
  const result = await window.api.settings.aliases.remove({ id: alias.id })
  if (!result.ok) return fail(result)
  if (cut.value?.kind === 'alias' && cut.value.id === alias.id) cut.value = null
  emit('updated', result.data)
  feedback('命令映射已删除', 'success')
}

async function toggleAlias(alias: Alias): Promise<void> {
  const result = await window.api.settings.aliases.update({ id: alias.id, enabled: !alias.enabled })
  if (!result.ok) return fail(result)
  emit('refresh')
}

/* ------------------------------------------------------------- cut & paste */

function cutEntry(kind: 'folder' | 'alias', id: string): void {
  cut.value = { kind, id }
  menu.value = null
}

function canPasteInto(): boolean {
  const source = cut.value
  if (!source) return false
  if (source.kind === 'folder') {
    return canMoveFolder(
      folders(),
      source.id,
      menu.value?.target.kind === 'folder' ? menu.value.target.id : null
    )
  }
  return true
}

function clearCut(): void {
  cut.value = null
}

async function pasteInto(targetFolderId: string | null): Promise<void> {
  const source = cut.value
  if (!source) return
  cut.value = null
  if (source.kind === 'folder') await moveFolder(source.id, targetFolderId)
  else await moveAlias(source.id, targetFolderId)
}

/* ---------------------------------------------------------------- alias form */

function startCreate(): void {
  editingId.value = null
  draft.command = ''
  draft.value = ''
  draft.enabled = true
  draft.folderId = selectedFolderId.value
  errors.value = {}
  formVisible.value = true
}

function startCreateIn(folderId: string | null): void {
  selectedFolderId.value = folderId
  startCreate()
}

function startEdit(alias: Alias): void {
  editingId.value = alias.id
  draft.command = alias.command
  draft.value = alias.value
  draft.enabled = alias.enabled
  draft.folderId = alias.folderId ?? null
  errors.value = {}
  formVisible.value = true
}

function cancelForm(): void {
  editingId.value = null
  formVisible.value = false
  errors.value = {}
}

function onDialogBackdrop(event: MouseEvent): void {
  if (event.target === dialogElement.value) cancelForm()
}

function onDialogClose(): void {
  if (formVisible.value) cancelForm()
}

function syncDialog(open: boolean): void {
  const element = dialogElement.value
  if (!element) return
  const isOpen = typeof element.open === 'boolean' ? element.open : element.hasAttribute('open')
  if (open && !isOpen) {
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    void nextTick(() => {
      const input = element.querySelector<HTMLInputElement>('#alias-command')
      input?.focus()
      input?.select()
    })
  } else if (!open && isOpen) {
    if (typeof element.close === 'function') element.close()
    else element.removeAttribute('open')
  }
}

watch(formVisible, (open) => syncDialog(open), { flush: 'post' })
onMounted(() => syncDialog(formVisible.value))

async function save(): Promise<void> {
  errors.value = validateAliasDraft(draft, aliases(), editingId.value)
  if (hasAliasErrors(errors.value)) return

  saving.value = true
  const payload = {
    command: draft.command,
    value: draft.value,
    enabled: draft.enabled,
    folderId: draft.folderId
  }
  const result = editingId.value
    ? await window.api.settings.aliases.update({ id: editingId.value, ...payload })
    : await window.api.settings.aliases.create(payload)
  saving.value = false

  if (!result.ok) {
    if (result.error.code === 'INVALID_PAYLOAD') {
      errors.value = { command: result.error.details ?? result.error.message }
    }
    return fail(result)
  }

  feedback(editingId.value ? '命令映射已更新' : '命令映射已添加', 'success')
  cancelForm()
  emit('refresh')
}

/* -------------------------------------------------------------- drag & drop */

function onDragStart(event: DragEvent, row: FolderTreeRow): void {
  dragSource.value = { kind: row.kind, id: row.id }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', row.id)
  }
}

function onDragOver(event: DragEvent, key: string): void {
  if (!dragSource.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTarget.value = key
}

function onDragLeave(key: string): void {
  if (dropTarget.value === key) dropTarget.value = null
}

async function onDrop(event: DragEvent, targetFolderId: string | null): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  const source = dragSource.value
  dragSource.value = null
  dropTarget.value = null
  if (!source) return
  if (source.kind === 'folder') {
    if (source.id === targetFolderId) return
    await moveFolder(source.id, targetFolderId)
  } else {
    await moveAlias(source.id, targetFolderId)
  }
}

function onDragEnd(): void {
  dragSource.value = null
  dropTarget.value = null
}

/* ------------------------------------------------------------ context menu */

async function openMenu(event: MouseEvent, target: MenuTarget): Promise<void> {
  menu.value = { x: event.clientX, y: event.clientY, target }
  await nextTick()
  const element = menuElement.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  menu.value = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8)),
    target
  }
}

function menuItems(target: MenuTarget): MenuItem[] {
  if (target.kind === 'alias') {
    const alias = aliases().find((item) => item.id === target.id)
    if (!alias) return []
    return [
      { label: '编辑映射', run: () => startEdit(alias) },
      {
        label: alias.enabled ? '停用映射' : '启用映射',
        run: () => void toggleAlias(alias)
      },
      { label: '剪切', run: () => cutEntry('alias', alias.id) },
      { label: '删除映射', danger: true, run: () => void removeAlias(alias) }
    ]
  }

  const folderId = target.kind === 'folder' ? target.id : null
  const items: MenuItem[] = [
    { label: '新建子文件夹', run: () => void createFolderIn(folderId) },
    { label: '在此新建映射', run: () => startCreateIn(folderId) },
    {
      label: '粘贴到此处',
      disabled: !canPasteInto(),
      run: () => void pasteInto(folderId)
    }
  ]

  if (target.kind === 'folder') {
    items.push(
      { label: '', run: () => undefined, separator: true },
      { label: '重命名', run: () => startRename(target.id) },
      { label: '剪切', run: () => cutEntry('folder', target.id) },
      { label: '删除文件夹', danger: true, run: () => void removeFolder(target.id) }
    )
  }

  return items
}

function runMenuItem(item: MenuItem): void {
  if (item.disabled || item.separator) return
  menu.value = null
  item.run()
}

function closeMenu(): void {
  menu.value = null
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  closeMenu()
  if (cut.value) cut.value = null
  if (renaming.value) renaming.value = null
}

onMounted(() => {
  window.addEventListener('click', closeMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', closeMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', closeMenu)
})
</script>

<template>
  <section id="aliases" class="card">
    <div class="card-heading">
      <div>
        <h2>命令映射</h2>
        <p>静态映射优先于插件和内置函数；命令名不区分大小写。拖拽移动，右键新建 / 剪切 / 删除。</p>
      </div>
      <div class="heading-actions">
        <button class="button ghost" type="button" @click="createFolderIn(selectedFolderId)">
          新建文件夹
        </button>
        <button class="button primary" type="button" @click="startCreateIn(selectedFolderId)">
          新增映射
        </button>
      </div>
    </div>

    <div v-if="conflicts().length > 0" class="warning-box">
      <strong>命令冲突</strong>
      <p v-for="conflict in conflicts()" :key="conflict.command">
        <code>{{ conflict.command }}</code> 同时存在于
        {{ conflict.sources.join(' / ') }}
        <template v-if="conflict.plugins?.length">（{{ conflict.plugins.join(', ') }}）</template>
      </p>
    </div>

    <dialog
      ref="dialogElement"
      class="alias-dialog"
      @close="onDialogClose"
      @cancel.prevent="cancelForm"
      @click="onDialogBackdrop"
      @keydown.esc.prevent="cancelForm"
    >
      <form class="alias-dialog-body" novalidate @submit.prevent="save">
        <div class="dialog-scroll">
          <div class="form-heading">
            <div>
              <h3>{{ editingId ? '编辑命令映射' : '新增命令映射' }}</h3>
              <p class="hint">{{ folderPath(folders(), draft.folderId) }}</p>
            </div>
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
            <div class="field">
              <label for="alias-folder">所属文件夹</label>
              <select id="alias-folder" v-model="draft.folderId" class="control">
                <option :value="null">根目录</option>
                <option v-for="folder in folders()" :key="folder.id" :value="folder.id">
                  {{ folderPath(folders(), folder.id) }}
                </option>
              </select>
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
        </div>
        <div class="dialog-actions">
          <span class="hint dialog-target">
            保存位置：{{ folderPath(folders(), draft.folderId) }}
          </span>
          <button class="button ghost" type="button" @click="cancelForm">取消</button>
          <button class="button primary" type="submit" :disabled="saving">
            {{ saving ? '保存中…' : '保存映射' }}
          </button>
        </div>
      </form>
    </dialog>

    <div v-if="cut" class="cut-banner">
      <span>已剪切「{{ cutLabel() }}」</span>
      <span class="hint">右键目标位置选择「粘贴到此处」，或直接拖拽</span>
      <button class="button ghost" type="button" @click="clearCut">取消</button>
    </div>

    <div
      class="tree-panel"
      @contextmenu.prevent="openMenu($event, { kind: 'root' })"
      @dragover="onDragOver($event, 'root')"
      @dragleave="onDragLeave('root')"
      @drop="onDrop($event, null)"
    >
      <div v-if="rows.length === 0" class="empty-state">
        还没有命令映射。右键新建文件夹或映射，把大量命令分组管理。
      </div>

      <ul v-else class="tree">
        <li
          v-for="row in rows"
          :key="`${row.kind}-${row.id}`"
          class="tree-row"
          :class="{
            'is-folder': row.kind === 'folder',
            'is-alias': row.kind === 'alias',
            'is-cut': isCut(row),
            'is-drop': dropTarget === `${row.kind}-${row.id}`,
            'is-current': row.kind === 'folder' && selectedFolderId === row.id,
            'is-expanded': row.kind === 'folder' && row.expanded,
            'is-off': row.kind === 'alias' && !row.alias.enabled
          }"
          :style="{ paddingLeft: `${row.depth * 18 + 8}px` }"
          :aria-expanded="row.kind === 'folder' ? row.expanded : undefined"
          :draggable="!(renaming && renaming.id === row.id)"
          @dragstart="onDragStart($event, row)"
          @dragend="onDragEnd"
          @dragover.stop="onDragOver($event, `${row.kind}-${row.id}`)"
          @dragleave.stop="onDragLeave(`${row.kind}-${row.id}`)"
          @drop.stop="onDrop($event, row.kind === 'folder' ? row.id : (row.alias.folderId ?? null))"
          @contextmenu.prevent.stop="openMenu($event, { kind: row.kind, id: row.id })"
          @click="onRowClick(row)"
        >
          <template v-if="row.kind === 'folder'">
            <button
              class="tree-chevron"
              type="button"
              :aria-label="row.expanded ? '收起' : '展开'"
              :aria-expanded="row.expanded"
              @click.stop="toggleFolder(row.id)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path
                  d="M6 3.5 10.5 8 6 12.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <input
              v-if="renaming && renaming.id === row.id"
              id="tree-rename-input"
              v-model="renaming.draft"
              v-focus
              class="control tree-rename"
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename"
              @click.stop
              @contextmenu.stop
            />
            <strong v-else class="tree-name" @dblclick.stop="startRename(row.id)">{{
              row.name
            }}</strong>
            <span v-if="!row.expanded && row.aliasCount > 0" class="tree-count">
              {{ row.aliasCount }}
            </span>
            <span class="tree-actions">
              <button
                class="tree-action"
                type="button"
                title="在此新建映射"
                @click.stop="startCreateIn(row.id)"
              >
                ＋
              </button>
              <button
                class="tree-action"
                type="button"
                title="更多"
                @click.stop="openMenu($event, { kind: 'folder', id: row.id })"
              >
                ⋯
              </button>
            </span>
          </template>

          <template v-else>
            <span class="tree-spacer" aria-hidden="true"></span>
            <code class="tree-command">{{ row.alias.command }}</code>
            <span class="tree-value" :title="row.alias.value">{{ row.alias.value }}</span>
            <button
              class="tree-toggle"
              type="button"
              :class="{ on: row.alias.enabled }"
              :aria-pressed="row.alias.enabled"
              @click.stop="toggleAlias(row.alias)"
            >
              {{ row.alias.enabled ? '已启用' : '已停用' }}
            </button>
            <span class="tree-actions">
              <button
                class="tree-action"
                type="button"
                title="编辑"
                @click.stop="startEdit(row.alias)"
              >
                编辑
              </button>
              <button
                class="tree-action"
                type="button"
                title="更多"
                @click.stop="openMenu($event, { kind: 'alias', id: row.id })"
              >
                ⋯
              </button>
            </span>
          </template>
        </li>
      </ul>

      <div class="tree-root-drop" :class="{ 'is-drop': dropTarget === 'root' }">
        拖到这里移到根目录 · 右键新建
      </div>
    </div>

    <p class="hint builtin-hint">
      内置命令：age、date、time、uuid、upper、lower。支持参数，例如
      <code>age 19</code>、<code>upper "hello world"</code>。插件命令会出现在插件区域。
    </p>

    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuElement"
        class="context-menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @contextmenu.prevent.stop
      >
        <template v-for="(item, index) in menuItems(menu.target)" :key="`${item.label}-${index}`">
          <hr v-if="item.separator" class="menu-separator" />
          <button
            v-else
            class="menu-item"
            :class="{ danger: item.danger }"
            type="button"
            :disabled="item.disabled"
            @click="runMenuItem(item)"
          >
            {{ item.label }}
          </button>
        </template>
      </div>
    </Teleport>
  </section>
</template>
