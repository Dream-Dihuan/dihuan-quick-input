/**
 * Shell navigation state: which page is visible, how the switch is animated, and
 * where the choice is remembered between launches.
 *
 * The app deliberately avoids a router — there are exactly two pages, both stay
 * mounted, and switching must not lose form or scroll state.
 */

export type ViewId = 'mappings' | 'settings'

export const VIEW_IDS: readonly ViewId[] = ['mappings', 'settings']

/** `localStorage` key holding the last viewed page. */
export const VIEW_STORAGE_KEY = 'diq.shell.view'

export interface ViewMeta {
  id: ViewId
  label: string
  description: string
}

export const VIEW_META: Record<ViewId, ViewMeta> = {
  mappings: {
    id: 'mappings',
    label: '映射与脚本',
    description: '命令映射与本地脚本'
  },
  settings: {
    id: 'settings',
    label: '设置',
    description: '快捷键、输入与浏览器扩展'
  }
}

/** Direction of a page switch: 1 forward, -1 backward, 0 unchanged. */
export type ViewDirection = -1 | 0 | 1

export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && (VIEW_IDS as readonly string[]).includes(value)
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Sandboxed or storage-disabled environments: behave like a fresh launch.
    return null
  }
}

export function readStoredView(): ViewId | null {
  const store = storage()
  if (!store) return null
  try {
    const value = store.getItem(VIEW_STORAGE_KEY)
    return isViewId(value) ? value : null
  } catch {
    return null
  }
}

export function storeView(view: ViewId): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // Persisting the view is a convenience; never let it break navigation.
  }
}

export interface InitialViewInput {
  onboardingComplete: boolean
  storedView?: ViewId | null
}

/**
 * First launch lands on the page that matter most: setup (settings) until the
 * onboarding guide is finished, then the daily work surface (mappings).
 * An explicit stored choice always wins.
 */
export function resolveInitialView(input: InitialViewInput): ViewId {
  if (input.storedView) return input.storedView
  return input.onboardingComplete ? 'mappings' : 'settings'
}

export function viewDirection(from: ViewId, to: ViewId): ViewDirection {
  if (from === to) return 0
  return VIEW_IDS.indexOf(to) > VIEW_IDS.indexOf(from) ? 1 : -1
}
