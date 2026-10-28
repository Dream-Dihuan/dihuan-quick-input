# Design

## Context

渲染层是 Vue 3.5 + electron-vite 的单入口应用：`index.html` → `src/renderer/src/main.ts` → `App.vue` → `SettingsApp.vue`（163 行），后者一次性渲染引导卡片、常规、命令映射、插件、浏览器连接五个区块；样式全部来自 `assets/main.css`（1184 行，含重复的 `.toggle` / `.tree-toggle` 与多套按钮变体），基线来自 Electron Forge 模板的 `assets/base.css`。

两个 BrowserWindow 都由 `src/main/app/windows.ts` 创建：设置窗口 1024×780（最小 860×640，原生边框），浮层 560×96（`frame: false`、透明、置顶）。渲染进程启用 `contextIsolation + sandbox`，只能通过 preload 暴露的 `window.api` 与主进程通信；页面 CSP 为 `default-src 'self'; style-src 'self' 'unsafe-inline'`，不允许远程样式或字体。

约束：

- 不得引入 vue-router、动画库或远程字体：`file://` 下的 history 路由、包体与 CSP 都会增加风险，而两个页面的状态切换用不到路由能力。
- `openspec/specs/command-mapping-folders` 已归档，其树行为与现有 DOM 测试（`.tree-row`、`.tree-chevron`、`.menu-item`、`.context-menu`、`.cut-banner`、`.heading-actions`、`.dialog-target`、`.field-error`）必须保持可用。
- Electron 44 支持 `titleBarStyle: 'hiddenInset'`、`trafficLightPosition` 与 Windows 的 `titleBarOverlay`（WCO）。
- `settings` 能力的基线规格目前只存在于进行中的变更 `add-quick-input-assistant`，本变更对其使用 MODIFIED（见 Risks 与 Migration Plan）。

## Goals / Non-Goals

**Goals:**

- 两个页面各有独立滚动容器与完整页面语义，切换零重新取数、零状态丢失。
- 一套令牌驱动全部颜色/间距/圆角/阴影/动效，`main.css` 从单文件拆为分层 CSS，删除重复选择器。
- 标题栏由渲染层绘制并承担拖动，macOS 交通灯与 Windows 系统按钮不被遮挡。
- 切换、悬停、按下、聚焦、toast 有统一节奏，并能在系统「减少运动」下自动降级。
- 主进程只改窗口选项与一个主→渲染事件，不触碰配置、命令解析与连接逻辑。

**Non-Goals:**

- 不引入主题切换、浅色主题或新的视觉语言（沿用现有深色 + 蓝色强调）。
- 不改造浮层窗口的尺寸、定位与焦点策略，仅让浮层样式复用令牌。
- 不提供页内脚本编辑器，不新增业务 IPC（只新增一个导航事件通道）。
- 不改变命令解析、文件夹模型与配置存储格式。

## Decisions

### D1 导航状态自建，两页同时挂载，`v-show` 切换

`ShellApp.vue` 持有 `activeView: 'mappings' | 'settings'`，两个 view 组件始终挂载，用 `v-show` 控制显隐，各自拥有独立的 `.page-scroll` 滚动容器。

- 为什么不用 `<Transition>` + 条件渲染 / `<KeepAlive>`：条件渲染会销毁表单与树状态；KeepAlive 卸载 DOM 时丢失滚动位置，还要额外恢复。两页同时挂载时「状态保持」是自然结果，成本是两份常驻 DOM（当前页面总规模约 1.2k 行模板，可接受）。
- 隐藏页加 `inert` 与 `aria-hidden="true"`，避免焦点进入与读屏重复播报；隐藏页内部的快捷键录制在不可见时暂停（`watch(activeView)`）。
- 页面堆叠用 `position: relative` 容器 + 两个 `position: absolute; inset: 0` 的页面层，两个方向的 Transition 都不会引起布局跳动，满足「切换时无高度跳变」。
- 视图 ID 持久化到 `localStorage['diq.shell.view']`；无记录时按 `config.onboardingComplete` 决定落到哪一页（未完成落 `settings`，完成落 `mappings`）。

### D2 托盘「设置」需要一个主→渲染导航事件

`showSettings()` 目前只负责显示与聚焦，渲染层无法知道调用来源。新增通道 `shell:show-view`（payload `{ view: 'mappings' | 'settings' }`），preload 暴露 `api.events.onShellView(cb)`。

- 备选：改 URL fragment（`window.loadURL(url + '#settings')`）——在 `file://` 下可用但会触发整页重载，违背「状态保持」与「不闪白」。
- 备选：把「当前页」存进配置——让导航成为持久化业务状态，且托盘点击仍需一条事件，收益为负。
- 事件窗口期：窗口在应用启动时就已创建，托盘点击时渲染层早已订阅；为覆盖窗口被销毁后重建的极端情况，沿用 `pendingSettingsShow` 的模式保存 `pendingShellView`，在 `ready-to-show` 时补发。

### D3 自绘标题栏只改窗口选项，不接管窗口控制按钮

| 平台    | 窗口选项                                                                                    | 渲染层处理                                                             |
| ------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| darwin  | `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 16, y: 17 }`                    | 顶栏 48px，左上留白 80px，交通灯区域不铺内容                           |
| win32   | `titleBarStyle: 'hidden'`, `titleBarOverlay: { color: '#0f1014', symbolColor: '#f3f3f7', height: 48 }` | 顶栏右侧留白 152px（`--shell-wco-width`），系统按钮由 WCO 绘制         |
| 其他    | 保持默认原生边框                                                                            | 隐藏自绘顶栏（`data-platform="linux"`），布局回到普通窗口               |

- 不用 `frame: false` 自绘三键：Windows 上自绘最小化/最大化/关闭要额外 IPC 与窗口状态同步，且关闭语义是「隐藏到托盘」，容易与系统行为冲突。WCO 免费获得正确的系统按钮、DPI 与无障碍语义。
- 拖动区：`.shell-drag`（`-webkit-app-region: drag`）只覆盖顶栏空白与侧栏品牌区；内部按钮、导航项、状态胶囊、输入框统一 `-webkit-app-region: no-drag`，避免点击被拖动吞掉。
- 平台判断复用现有 `detectPlatform()`（`hotkey-recorder.ts`），渲染层不需要新 IPC。顶栏写入 `document.documentElement.dataset.platform`，CSS 用属性选择器处理留白。

### D4 令牌分层与 CSS 拆分

新增 `assets/tokens.css`，保留 `base.css`（仅 reset）、`main.css`（入口 + `@import`）、新增 `shell.css`（顶栏/侧栏/页面层）与 `components.css`（按钮、输入、卡片、树、对话框、菜单、toast）。浮层 `overlay.css` 也 `@import` 同一份 tokens。

关键令牌值（深色，沿用现有观感）：

| 类别   | 令牌                                                                                          |
| ------ | --------------------------------------------------------------------------------------------- |
| 背景   | `--bg-app: #0f1014`, `--bg-surface-1: #16171d`, `--bg-surface-2: #1c1e26`, `--bg-surface-3: #22242e` |
| 边框   | `--border-subtle: rgba(255,255,255,.08)`, `--border-strong: rgba(255,255,255,.14)`             |
| 文本   | `--text-1: #f3f3f7`, `--text-2: rgba(235,235,245,.66)`, `--text-3: rgba(235,235,245,.42)`      |
| 强调   | `--accent: #8ea6ff`, `--accent-strong: #a9bbff`, `--accent-on: #111423`, `--accent-soft: rgba(142,166,255,.14)` |
| 语义   | `--success: #77d6a2`, `--warning: #e8bf75`, `--danger: #ff8585` + 各自 `-soft`（.10）与 `-border`（.28） |
| 间距   | `--space-1..8: 4/6/8/12/16/20/24/32px`（另有 `40px` 的 `--space-9`）                            |
| 圆角   | `--radius-xs: 6`, `--radius-sm: 8`, `--radius-md: 10`, `--radius-lg: 12`, `--radius-xl: 16`, `--radius-pill: 999` |
| 字号   | `--text-xs: 11`, `--text-sm: 12`, `--text-base: 13`, `--text-md: 15`, `--text-lg: 17`, `--text-xl: 20` |
| 阴影   | `--shadow-1: 0 1px 2px rgba(0,0,0,.24)`, `--shadow-2: 0 12px 32px rgba(0,0,0,.32)`, `--shadow-3: 0 24px 70px rgba(0,0,0,.42)` |
| 动效   | `--motion-fast: 120ms`, `--motion-base: 180ms`, `--motion-slow: 240ms`, `--ease-standard: cubic-bezier(.2,.8,.2,1)`, `--ease-emphasized: cubic-bezier(.22,1,.36,1)` |
| 布局   | `--shell-titlebar: 48px`, `--sidebar-w: 232px`, `--content-max: 980px`                          |

迁移策略：第一阶段 tokens 里额外保留旧变量名（`--surface`、`--text-main`、`--border` 等）作为别名指向新令牌，保证样式拆分过程零视觉回归；确认无引用后再删除别名。

### D5 动效与降级

- 页面切换：`opacity 0→1` + `translate3d(±12px,0,0) → 0`，时长 `--motion-base`(180ms) / `--ease-emphasized`；离场 120ms。方向由导航顺序决定（映射→设置为 +1，反向为 -1）。
- 侧栏指示条：单个绝对定位元素按激活项 `translateY` 移动，200ms 同缓动；不逐个改背景色，避免跳变。
- 悬停/按下/聚焦：hover `--motion-fast`，press `transform: scale(.985)` 80ms，focus ring 立即出现（无过渡延迟）。
- toast：入场 `opacity + translateY(8px)` 160ms，离场 120ms；单条替换不排队。
- 降级：`@media (prefers-reduced-motion: reduce)` 把 `--motion-*` 置 0ms 并移除位移/缩放的 `transform`，只保留瞬时状态；同时保留连续动画的 `transition: none`（避免 0ms 过渡产生闪烁）。

### D6 数据流与写入节奏

`ShellApp` 持有 `SettingsState`、订阅 `onSettingsState` / `onAppError` / `onShellView`、渲染唯一的 toast；两个 view 只通过 props 拿状态，通过 `updated` / `refresh` / `feedback` 事件回传。切换页面不重新 `getState()`。

「变更即保存」只用于离散控件（插入方式、登录启动）：控件先乐观更新，再调用 `updateGeneral`，失败回滚并 `feedback`。并发写入用单飞队列（`let chain = Promise.resolve()`）串行化，避免连续切换选项时响应乱序覆盖。快捷键仍为「录制 → 应用」两段式（保存失败要明确保留旧值），但「应用」按钮在值未变化时禁用。

### D7 映射过滤扩展既有树构建器

`folder-tree.ts` 的 `buildFolderTreeRows` 增加可选 `query` 参数：非空时按 `command` / `value` 做大小写不敏感匹配，收集命中映射的祖先文件夹集合并忽略折叠状态（自动展开），仅输出命中映射与其祖先。签名保持向后兼容，复用现有纯函数测试风格。过滤框放在卡片头部工具行，150ms 防抖，`Escape` 清空；无匹配时复用 `.empty-state` 但使用独立文案。

### D8 组件与文件结构

```
src/renderer/src/
  shell/ShellApp.vue        外壳：侧栏 + 顶栏 + 页面堆叠 + 状态与 toast
  shell/AppSidebar.vue      品牌区 + 导航项 + 底部状态（连接点、版本）
  shell/AppTitlebar.vue     拖动区、平台留白、右侧状态胶囊
  shell/navigation.ts       视图 ID、持久化、键盘切换、方向计算
  views/MappingsView.vue    映射与脚本页：AliasSection + PluginSection
  views/SettingsView.vue    设置页：Onboarding + GeneralSection + ConnectionSection
  settings/*.vue            既有 Section 复用，仅调整头部与保存节奏
```

`App.vue` 改为渲染 `ShellApp`，`SettingsApp.vue` 删除。`AliasSection.vue` 的树、右键菜单、拖拽、对话框完全保留（类名不变），只新增卡片头部工具行。

### D9 测试策略

- 保留并运行现有 170 个单元/DOM 用例；`alias-section.test.ts` 依赖的类名不重命名。
- 新增 `tests/dom/shell/shell-navigation.test.ts`：两页渲染、点击与 `⌘2` 切换、`aria-current`、切走再切回保留表单内容、托盘事件切到设置页。
- 新增 `tests/dom/settings/general-auto-save.test.ts`：切换插入方式立即调用 `updateGeneral`、失败回滚、连续切换串行化。
- 扩展 `tests/dom/settings/folder-tree.test.ts`：过滤命中、祖先保留、空结果、清空恢复。
- 标题栏与平台留白属于窗口几何，无法在 jsdom 断言，进入 `docs/manual-test.md` 手工矩阵。

## Risks / Trade-offs

- [两页常驻 DOM 导致隐藏页仍占内存/仍可能响应全局键盘事件] → 隐藏页 `inert` + `aria-hidden`；录制监听在不可见时暂停，副作用只走 `watch(activeView)`。
- [Windows WCO 在 125%/150% 缩放下可能与右侧状态胶囊重叠] → 固定 152px 留白 + 顶栏内容左对齐；手工矩阵覆盖 100%/125%/150% 与最小窗口尺寸。
- [macOS 交通灯在最大化/全屏时与侧栏品牌区重叠] → 顶栏左侧 80px 留白 + 品牌区只放下方；手工验证全屏与分屏。
- [CSS 拆分造成遗漏样式或视觉回归] → 分两阶段：先落地 tokens + 旧变量别名，再迁移选择器；每阶段跑 `pnpm lint && pnpm test && pnpm build` 并逐页目视对照。
- [「变更即保存」误写配置] → 只对离散控件生效，变更前校验、失败回滚、单飞队列串行化；不引入整页自动保存。
- [`settings` delta 为 MODIFIED 而主规格尚不存在，archive 会拒绝] → 归档顺序：先 `add-quick-input-assistant` 归档（或 `openspec sync specs` 同步 `settings` 能力），再归档本变更；`openspec validate` 目前以 INFO 提示该依赖，不阻塞开发。
- [自绘标题栏改变窗口可拖动区域，可能影响用户拖动/双击预期] → 拖动区覆盖顶栏与侧栏顶部空白，保留系统快捷键；Windows 上 WCO 区域仍支持系统双击行为。

## Migration Plan

1. `tokens.css` + 分层 CSS 骨架落地，旧变量名保留为别名，确保零视觉变化（可独立回滚）。
2. 拆出 `ShellApp` / 两个 view，保留所有既有 Section 与类名；导航、状态保持、toast 上新。
3. 主进程窗口选项与 `shell:show-view` 事件接入，`App.vue` 切到 `ShellApp`。
4. 映射过滤、「变更即保存」、设置页分组重排。
5. 删除旧变量别名与死样式，跑 `pnpm lint`、`pnpm test`、`pnpm typecheck`、`pnpm build`，更新 `docs/manual-test.md`。

回滚：主进程窗口选项与事件可单独回退（恢复原生标题栏）；渲染层改动集中在 `shell/`、`views/` 与 CSS 分层，回退 `App.vue` 入口即可恢复旧页面。

## Open Questions

- 过滤框是否需要同时匹配插件命令名（脚本分组的命令芯片）？当前实现只覆盖映射列表，若后续需要再扩展匹配源。