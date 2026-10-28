# Tasks

## 1. 设计令牌与样式分层

- [x] 1.1 新增 `src/renderer/src/assets/tokens.css`，按 design D4 定义颜色/间距/圆角/字号/阴影/动效/布局令牌，并把旧变量名（`--accent`、`--surface`、`--surface-strong`、`--surface-muted`、`--border`、`--border-strong`、`--text-main`、`--text-soft`、`--text-faint`、`--shadow`、`--danger`、`--success`、`--warning`、`--accent-soft`、`--accent-strong`）作为别名指向新令牌；验证：`pnpm build` 通过，启动后设置页与改动前逐项对比无视觉差异
- [x] 1.2 把 `main.css` 拆为入口（`@import` 聚合）+ `shell.css`（顶栏、侧栏、页面层）+ `components.css`（按钮、输入、卡片、树、对话框、菜单、toast），删除 `.toggle` 与 `.tree-toggle` 的重复定义并合并为一套状态胶囊样式；验证：`pnpm build` 通过，`grep -c "tree-toggle" src/renderer/src/assets/*.css` 只剩一处定义，设置页所有控件外观不变
- [x] 1.3 清理 `base.css` 中 Electron Forge 模板残留的 `--ev-c-*` 变量与无用 reset，保留 box-sizing/字体/文本渲染；验证：`pnpm build` 通过，`grep -rn "ev-c-" src/renderer/src` 无结果
- [x] 1.4 `overlay.css` 改为 `@import './tokens.css'` 并替换硬编码颜色（`#b9c6ff`、`#ff8b8b`、`rgba(28,28,32,.96)`）为令牌，同时用令牌补齐浮层入场动画（160ms 淡入 + 4px 上移，`prefers-reduced-motion` 下取消位移）；验证：`pnpm test` 中 `tests/dom/overlay/overlay-app.test.ts` 通过，`pnpm dev` 下浮层描边/强调色与设置页一致

## 2. 外壳、侧栏与双页导航

- [x] 2.1 新增 `src/renderer/src/shell/navigation.ts`：定义 `ViewId = 'mappings' | 'settings'`、`localStorage['diq.shell.view']` 读写（读取失败时回退）、`resolveInitialView(config)`（无记录时按 `onboardingComplete` 决定）与方向计算；验证：新增 `tests/dom/shell/navigation.test.ts` 覆盖默认值、持久化读取、无记录时的两条分支，`pnpm test` 通过
- [x] 2.2 新增 `shell/ShellApp.vue`：持有 `SettingsState`、`activeView`、toast 状态，迁移 `SettingsApp.vue` 的 `getState` 加载、`onSettingsState` / `onAppError` 订阅与错误面板，把两个页面放进 `position: relative` 堆叠容器，非活动页加 `inert` 与 `aria-hidden`；验证：`tests/dom/shell/shell-navigation.test.ts` 中两页同时存在且只有一个可见，`pnpm test` 通过
- [x] 2.3 新增 `shell/AppSidebar.vue`：品牌区、两个导航项（图标 + 标签 + 映射数量徽标）、当前项 `aria-current="page"`、滑动指示条、底部连接状态点与版本；验证：DOM 测试断言两个导航按钮、`aria-current` 跟随切换、点击切换页面
- [x] 2.4 新增 `shell/AppTitlebar.vue`：48px 顶栏，`.shell-drag` 拖动区（`-webkit-app-region: drag`），内部交互元素 `no-drag`，按 `document.documentElement.dataset.platform` 处理 macOS 80px 左侧留白与 Windows 152px 右侧留白；验证：DOM 测试断言顶栏存在、平台属性为 `darwin|win32|linux` 时对应 class 生效
- [x] 2.5 新增 `views/MappingsView.vue`（`AliasSection` + `PluginSection`）与 `views/SettingsView.vue`（`OnboardingCard` + `GeneralSection` + `ConnectionSection`），两页各带独立 `.page-scroll` 容器；把 `App.vue` 改为渲染 `ShellApp` 并删除 `SettingsApp.vue`；验证：`pnpm typecheck:web` 通过，应用启动后侧栏两个入口分别显示映射树/脚本与快捷键/浏览器扩展，且没有第三方滚动条
- [x] 2.6 实现键盘切换：窗口内 `CommandOrControl+1` / `CommandOrControl+2` 切换页面，输入框/文本域/contenteditable 聚焦或模态对话框打开时不拦截；侧栏方向键在导航项间移动焦点，验证：DOM 测试断言 `⌘1`/`⌘2` 生效、输入框内按键不切换页面
- [x] 2.7 状态保持：切换页面后保留滚动位置、树展开状态与未提交的映射表单；录制中的快捷键状态保留但停留在映射页时不拦截按键（`watch(activeView)` 启停 keydown 监听）；验证：DOM 测试断言填写表单→切走→切回后对话框仍开且值不变
- [x] 2.8 在 `docs/manual-test.md` 增加「双页面导航」小节（侧栏切换、`⌘1/⌘2`、切回后表单与滚动位置、首次启动落点、从托盘进入设置页），标注需手工验收的项；验证：文档中每条都能被人工按步骤执行

## 3. 主进程窗口外壳与导航事件

- [x] 3.1 `src/main/app/windows.ts` 的 `createSettingsWindow` 增加平台分支：darwin 用 `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 16, y: 17 }`，win32 用 `titleBarStyle: 'hidden'` + `titleBarOverlay`（`color: '#0f1014'`、`symbolColor: '#f3f3f7'`、`height: 48`），其他平台保持默认；验证：`pnpm typecheck:node` 与 `pnpm build` 通过，macOS 上交通灯完整可见且窗口可拖动
- [x] 3.2 新增 `ipcChannels.eventShellView = 'shell:show-view'`、`AppShellView` 类型与 preload 的 `events.onShellView(cb)`（含 `src/shared/ipc.ts` 的 `EventApi` 与 `src/preload/index.ts`）；验证：`pnpm typecheck` 通过，`tests/node/shared-schema.test.ts` 与 `tests/node/ipc/validation.test.ts` 通过
- [x] 3.3 `showSettings()` 发送 `{ view: 'settings' }`，并用与 `pendingSettingsShow` 相同的模式保存 `pendingShellView` 在 `ready-to-show` 补发；`ShellApp` 订阅该事件切到设置页并持久化视图；验证：DOM 测试模拟事件后当前页为设置页，`pnpm test` 通过
- [x] 3.4 `docs/manual-test.md` 增加标题栏小节：macOS 全屏/分屏下交通灯与侧栏不重叠、双击与拖动、Windows 100%/125%/150% 缩放下系统按钮与右侧状态胶囊不重叠、最小窗口 860×640 下不遮挡；验证：条目可在目标机器逐条执行并记录结果

## 4. 动效、降级与反馈通道

- [x] 4.1 页面切换过渡：方向感知的 `opacity + translate3d`（进入 180ms / 离开 120ms），两页绝对定位避免高度跳变，连续切换不叠加动画；验证：DOM 测试断言切换时同时只有一个页面处于可见状态，人工快速连点 5 次无残影
- [x] 4.2 交互节奏：把按钮、输入框、树行、状态胶囊、菜单项的 hover/press/focus 统一到 `--motion-fast` 与共享 focus ring，侧栏指示条用单个元素 `translateY` 移动；验证：`pnpm lint` 通过，`grep -rn "cubic-bezier\|120ms\|180ms" src/renderer/src --include=*.vue` 无组件内硬编码缓动或时长
- [x] 4.3 `prefers-reduced-motion` 降级：在该媒体查询下把所有动效令牌置 0ms、移除位移与缩放、保留焦点环即时可见；验证：在系统「减少运动」下切换页面与打开对话框无位移动画，DOM 测试不依赖动画时长
- [x] 4.4 toast 反馈：固定右下角、单条替换、成功 5s 自动消失、错误保留原因，跨页面切换不丢失；把各 Section 的 `feedback` 事件统一接到 shell 的 toast 通道；验证：DOM 测试用假定时器断言单条显示与自动消失，连续两次反馈只保留最新一条
- [x] 4.5 统一错误呈现：卡片级 `warning-box`（配置恢复、连接错误、插件错误、命令冲突）改为可折叠摘要（默认一条摘要 + 展开明细），行内 `field-error` 保留；验证：DOM 测试断言无错误时不渲染、有错误时摘要可见且展开后显示明细

## 5. 设置页重排与即时保存

- [x] 5.1 `GeneralSection.vue` 分组为「快捷键」与「输入与启动」两块，快捷键保留「录制 → 应用」两段式，值未变化时按钮禁用；验证：DOM 测试断言未改动时按钮禁用、录制后按钮可用
- [x] 5.2 插入方式与登录启动改为变更即保存：乐观更新 → `updateGeneral`，失败回滚并 toast，连续变更用单飞队列串行化；验证：新增 `tests/dom/settings/general-auto-save.test.ts` 覆盖成功、失败回滚、连续切换顺序
- [x] 5.3 `ConnectionSection.vue` 标题改为「浏览器扩展」，连接状态胶囊、端口、令牌复制/轮换与连接列表按令牌样式重排，最近错误进入 4.5 的折叠区块；验证：DOM 测试或人工确认复制/轮换事件仍触发对应 API，`pnpm test` 通过
- [x] 5.4 `OnboardingCard.vue` 迁移到设置页顶部，步骤 3 增加「前往映射与脚本」按钮（切页并聚焦脚本分组），完成后卡片消失；验证：DOM 测试断言 `onboardingComplete === false` 时显示、步骤 3 触发视图切换、完成后隐藏

## 6. 映射页工具行与过滤

- [x] 6.1 `folder-tree.ts` 的 `buildFolderTreeRows` 增加可选 `query` 参数：大小写不敏感匹配 `command` / `value`，命中映射的祖先文件夹自动保留并展开，签名向后兼容；验证：扩展 `tests/dom/settings/folder-tree.test.ts` 覆盖过滤命中、祖先保留、空结果、清空恢复
- [x] 6.2 `AliasSection.vue` 卡片头部增加工具行（过滤框 + 新建文件夹 + 新增映射），过滤 150ms 防抖、`Escape` 清空、无匹配显示「没有匹配的命令映射」空状态；验证：`tests/dom/settings/alias-section.test.ts` 扩展过滤用例并通过，原有树/菜单/对话框用例不受影响
- [x] 6.3 确认既有类名契约不被破坏（`.tree-row`、`.tree-chevron`、`.tree-count`、`.menu-item`、`.context-menu`、`.cut-banner`、`.heading-actions .button.ghost`、`.heading-actions .button.primary`、`.dialog-target`、`.field-error`）；验证：`pnpm test` 全绿，`grep` 确认上述类名仍存在于模板中

## 7. 集成验收

- [x] 7.1 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，修复全部失败项；验证：四条命令均以 0 退出
- [ ] 7.2 运行 `pnpm test:e2e`，确认扩展插入相关 4 个 Playwright 场景仍通过（本次不修改扩展与浮层行为）；验证：E2E 全绿
- [ ] 7.3 逐页目视核对两个页面与浮层：字号/间距/圆角/状态色一致，无重复滚动条、无布局跳动、无残留旧样式；检查 `prefers-reduced-motion` 与键盘焦点；验证：对照 `docs/manual-test.md` 新增小节逐条勾选

## Workflow follow-up

- 归档顺序：先归档或同步 `add-quick-input-assistant`（建立 `settings` 基线规格），再归档本变更，避免 MODIFIED delta 因目标规格缺失被拒绝。
- 归档前确认 `openspec validate restructure-ui-shell --strict` 无警告。
