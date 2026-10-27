# Design

## Context

当前仓库是 electron-vite 生成的空白 Electron + Vue + TypeScript 项目：Electron 44、Vue 3、Vite 8、electron-vite 6、electron-builder 26，主进程只有模板窗口，渲染进程只有一个示例页，尚无测试与业务代码。`openspec/specs/` 为空，本变更会建立第一批能力。

已确认的产品约束（详见 `proposal.md`）：

- 桌面应用负责全局快捷键、输入浮层、命令解析和设置页。
- Chrome / Edge 扩展负责网页字段跟踪与 DOM 写入，桌面应用不直接访问浏览器。
- 第一版支持 macOS 与 Windows；Linux、Firefox、Safari 不在范围内。
- 命令扩展采用“静态别名 + 内置函数 + 本地 JS 插件”，插件函数可接收参数并返回文本。

本设计只讨论实现方式；行为契约见 `specs/quick-input-overlay/spec.md`、`specs/command-engine/spec.md`、`specs/browser-insertion/spec.md`、`specs/settings/spec.md` 和 `specs/app-lifecycle/spec.md`。

## Goals / Non-Goals

**Goals:**

- 用桌面浮层 + 浏览器扩展的组合，在不申请系统辅助功能权限的前提下完成“唤起 → 输入 → 写入网页字段”。
- 让命令解析、插件、配置、协议等核心逻辑可在 Node 环境中独立测试，不依赖真实 Electron 或浏览器。
- 在 MV3 生命周期、iframe、React/Vue 受控表单、中文输入法和多浏览器并存等场景下保持可预测行为。
- 保持本地优先：无云端、无页面内容采集、连接只走回环地址。

**Non-Goals:**

- 向浏览器之外的桌面应用注入文本。
- Firefox、Safari、Linux 支持，以及浏览器商店正式上架。
- 密码、支付卡等敏感字段的自动填充。
- 富文本编辑器（ProseMirror、Lexical、Quill 等）的完整语义支持；`contenteditable` 只做尽力而为的插入。
- 把本地插件当作恶意代码的强安全边界；插件是用户自行安装的本地代码。
- 自动更新、账号体系、配置云同步。

## Decisions

### 1. 进程与通信拓扑：Electron 主进程 + MV3 Service Worker + Content Script

```text
┌──────────────────────────── Electron ────────────────────────────┐
│ main process                                                     │
│  HotkeyManager   OverlayWindow   SettingsWindow   Tray           │
│  CommandEngine   ConfigStore     ConnectionServer (ws, loopback) │
│         ▲                │                    ▲                  │
│         │ typed IPC      │                    │ WebSocket        │
│  preload/renderer (Vue: settings + overlay)   │ token + JSON     │
└───────────────────────────────────────────────┼──────────────────┘
                                                │
                                  127.0.0.1:47821-47830
                                                │
┌──────────────────────────── Browser extension ────────────────────┐
│ Service Worker                                                   │
│  WebSocket client, reconnect/heartbeat, focus map, routing       │
│         ▲ chrome.runtime messages                                │
│  Content Script (all frames)                                     │
│  focus tracking, editable detection, DOM insertion               │
│  Popup: pairing token + connection status                        │
└───────────────────────────────────────────────────────────────────┘
```

选择理由：

- 桌面应用无法读取浏览器 DOM，扩展是唯一不依赖系统辅助功能权限、又能兼容受控表单的可靠方案。
- 全局快捷键和浮层放在 Electron，能覆盖“浏览器在前台时按快捷键”的体验，并让快捷键、映射、插件集中在设置页管理。
- 命令解析放在主进程：插件需要 Node 的模块加载与 `vm` 能力，且解析结果只通过本地连接传给扩展，渲染进程不接触插件代码。

考虑过的替代方案：

- **系统级剪贴板 + 模拟粘贴**：不需要扩展，但需要 macOS 辅助功能/Windows 自动化权限，无法可靠判断目标字段，且会污染剪贴板。用户已选择扩展方案。
- **Chrome Native Messaging**：鉴权和进程唤醒更可靠，但需要安装 native host 清单、处理平台注册与打包，显著增加安装复杂度。保留为未来如果本地 WebSocket 受浏览器策略限制时的升级路径。
- **Content Script 直接连接本地 WebSocket**：可绕开 Service Worker 休眠，但请求受页面 CSP/本地网络访问策略影响，token 也会进入页面上下文。统一走 Service Worker 更容易控制权限与生命周期。
- **页面内浮层（完全由扩展渲染）**：可避免焦点切换，但无法提供全局快捷键与统一的桌面设置入口，不符合已确认的产品形态。

### 2. 本地连接协议与连接管理

- 主进程使用 `ws` 启动 WebSocket 服务，只绑定 `127.0.0.1`。默认尝试端口 `47821`–`47830`，取第一个可用端口；全部占用时报告连接错误并按退避重试。
- 首次启动生成 32 字节随机 token（base64url），保存在配置中；设置页显示 token 与“复制/轮换”操作。扩展 popup 粘贴 token 后写入 `chrome.storage.local`。
- 握手：扩展连接后 2 秒内发送 `hello { v: 1, token, extensionVersion, browserName }`；服务端校验 token 后回复 `welcome { v: 1, appVersion, heartbeatMs: 20000 }`，否则回复 `error` 并关闭。token 使用恒定时间比较。
- 连接只接受 `chrome-extension://` 来源；无 Origin 或非扩展来源在 token 正确时仍拒绝，防止普通网页直接连接。握手失败和超时都记录为诊断信息，不记录 token。
- 消息类型（JSON，单条上限 64 KiB）：

```ts
type ClientMessage =
  | { v: 1; type: 'hello'; token: string; extensionVersion: string; browserName: string }
  | { v: 1; type: 'pong'; ts: number }
  | { v: 1; type: 'page-focus'; ts: number }
  | { v: 1; type: 'insert-result'; id: string; ok: boolean; code?: string; message?: string }

type ServerMessage =
  | { v: 1; type: 'welcome'; appVersion: string; heartbeatMs: number }
  | { v: 1; type: 'ping'; ts: number }
  | { v: 1; type: 'insert'; id: string; text: string; mode: 'caret' | 'replace' }
  | { v: 1; type: 'error'; code: string; message: string }
```

- 心跳：服务端每 20 秒发应用层 `ping`，扩展回 `pong`；连续 3 次无响应则断开。该流量同时用于维持 MV3 Service Worker（Chrome 116+ 的 WebSocket 活动会重置空闲计时器）。
- 扩展重连：`close`/`error` 后按 0.5s、1s、2s、5s、10s 退避；`chrome.alarms` 每 30 秒兜底唤醒并检查连接。Service Worker 被回收后，启动时重新读取 token、扫描端口并握手。
- 插入请求带 `id`，桌面端等待 3 秒；超时、连接断开或收到失败结果都转换为浮层可见错误，不重试写入，避免重复插入。
- 多浏览器：每个连接记录最近一次 `page-focus` 时间。插入时只选择该时间最新的连接；若存在多个连接但没有任何 `page-focus`，返回“无法确定目标浏览器”。不向所有连接广播。
- 端口和连接状态通过 IPC 实时推送到设置页；轮换 token 后关闭所有现有连接。

### 3. 浮层与全局快捷键

- 新增独立渲染入口 `src/renderer/overlay.html` + `OverlayApp.vue`，与设置页 `index.html` 分开打包。electron-vite 的 renderer `rollupOptions.input` 配置两个 HTML 入口；开发模式加载 `${ELECTRON_RENDERER_URL}/overlay.html`，生产模式 `loadFile`。
- 浮层窗口在应用启动时创建并隐藏，避免每次快捷键都重新创建造成的延迟。窗口参数：`560×96`、`frame: false`、`transparent: true`、`resizable: false`、`show: false`、`alwaysOnTop: true`、`skipTaskbar: true`；显示时调用 `setAlwaysOnTop(true, 'floating')`、`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`，并用 `screen.getDisplayNearestPoint(screen.getCursorScreenPoint())` 计算居中位置。
- 打开浮层时通过 `webContents.send('overlay:open')` 重置组件状态；输入框自动聚焦。Escape、窗口 `blur` 都触发隐藏；提交进行中时忽略重复 Enter。
- 中文输入法：监听 `compositionstart` / `compositionend`，Enter 处理同时检查 `event.isComposing` 和 `keyCode === 229`；组合状态中不提交。
- 快捷键管理器封装 `globalShortcut`。更新流程为“先注册新快捷键，成功后再注销旧快捷键”；失败时保留旧快捷键并把错误返回设置页。默认值 `CommandOrControl+Shift+Space`。
- 提交链路：

```text
OverlayApp --IPC overlay:submit(rawText)--> main
main: parse + resolve -> ConnectionServer.insert(text, mode)
  ├─ success -> IPC overlay:result {ok:true} -> 浮层短暂显示成功并隐藏
  └─ failure -> IPC overlay:result {ok:false, code, message} -> 浮层保持打开并显示错误
```

- 插入成功后的焦点恢复：先隐藏浮层；在 macOS 调用 `app.hide()` 把激活状态交还前台应用（托盘仍可用），Windows 依赖隐藏窗口后系统恢复前台窗口。由于扩展是直接写 DOM，即使系统焦点恢复失败，插入结果仍然有效。

### 4. 命令引擎

模块划分（主进程内，纯函数优先）：

- `parser.ts`：把原始输入解析为 `{ name, args, rawArgs }`。按空白拆分，支持单/双引号和反斜杠转义；命令名统一小写（ASCII 大小写不敏感）；空输入返回 `null`。
- `registry.ts`：维护命令快照，记录来源（alias / plugin / builtin）和冲突信息；解析顺序固定为 alias → plugin → builtin。
- `builtins.ts`：内置函数。首版包含：
  - `age <integer>` → `${n} 岁`，校验非负整数；
  - `date` → 本地 `YYYY-MM-DD`；
  - `time` → 本地 `HH:mm`；
  - `uuid` → 随机 UUID；
  - `upper <text...>` / `lower <text...>` → 大小写转换。
- `plugin-host.ts`：扫描插件目录、加载模块、维护插件上下文与错误。
- `resolver.ts`：执行解析并统一错误码（`COMMAND_NOT_FOUND`、`INVALID_ARGS`、`PLUGIN_ERROR`、`PLUGIN_TIMEOUT`、`INVALID_RESULT` 等）。

插件契约：

- 目录默认 `app.getPath('userData')/plugins`，扫描 `.js` / `.cjs` 文件，按文件名排序。
- 每个文件使用 CommonJS 形式导出：

```js
module.exports = {
  name: 'my-plugin',
  commands: {
    company: (args, ctx) => {
      // args: string[]，ctx: { rawArgs, now, locale }
      return '示例公司'
    }
  }
}
```

- 函数必须同步返回非空字符串；返回 Promise、对象、数字、空字符串都视为 `INVALID_RESULT`。参数和上下文只以 JSON 基本类型传入，避免把宿主对象暴露给插件。
- 沙箱：`node:vm` 创建独立 context，不提供 `require`、`process`、`Buffer`、定时器、网络或文件系统 API。插件加载和执行通过 `vm.runInContext(..., { timeout })` 执行：加载超时 1000ms，单次命令 200ms；输出上限 10,000 字符。
- 插件重载原子替换命令快照：先完整解析所有插件，生成新快照后一次性切换；单个插件失败只记录错误，不影响其他插件。
- **安全边界说明**：`vm` 不是针对恶意代码的强隔离。插件是用户主动放入本地目录并信任的代码；沙箱用于阻止误用全局对象、限制执行时间和提供可诊断错误。若未来需要执行不可信插件，改用 `isolated-vm` 或独立进程，并重新评估原生依赖打包成本。

### 5. 配置与持久化

配置使用版本化 JSON，放在 `app.getPath('userData')/config.json`：

```ts
type AppConfig = {
  version: 1
  onboardingComplete: boolean
  hotkey: string                    // 默认 CommandOrControl+Shift+Space
  insertMode: 'caret' | 'replace'   // 默认 caret
  launchAtLogin: boolean            // 默认 false
  server: {
    token: string                   // 首次启动生成
  }
  aliases: Array<{
    id: string
    command: string
    value: string
    enabled: boolean
  }>
  plugins: {
    enabled: boolean                // 默认 true
  }
}
```

- 使用 `zod` 校验完整配置与 IPC 输入；解析失败时把原文件重命名为 `config.corrupt-<timestamp>.json`，加载默认配置，并在设置页显示一次性提示。
- 使用 `write-file-atomic` 写入，避免半写文件；Unix 下配置文件权限设为 `0600`。
- 版本升级通过 `migrations` 映射逐步迁移；当前只有 v1，保留迁移入口。
- 插件目录固定为 `userData/plugins`，首次启动创建目录和 `README.md`（不自动生成可执行示例，避免用户困惑）。设置页提供“打开插件目录”。
- 配置写入由主进程串行化；设置页修改通过 IPC 提交，主进程校验、落盘成功后再广播新状态，避免 UI 与磁盘不一致。
- 日志只记录错误码、耗时和插件文件名，不记录 token、命令结果或用户输入内容。

### 6. 浏览器扩展

清单要点：

```json
{
  "manifest_version": 3,
  "minimum_chrome_version": "116",
  "permissions": ["storage", "alarms"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "all_frames": true,
      "match_about_blank": true,
      "run_at": "document_idle"
    }
  ],
  "action": { "default_popup": "popup.html" }
}
```

- 不申请 `tabs`、`webNavigation`、`history` 等会扩大权限提示的 API；`chrome.tabs.query`/`sendMessage` 在无 `tabs` 权限时仍可获取活动 tab id 并发送消息。
- Service Worker 状态：`Map<tabId, { frameId, lastFocusAt }>`、连接对象、最近一次错误。`tabs.onRemoved` 和 `tabs.onUpdated`（`status === 'loading'`）清除对应 tab 记录。
- Content Script：
  - 用 `focusin` 捕获阶段记录最后一个可编辑元素；不因 `focusout` 清除（浮层获得焦点时页面会失去焦点，但仍需保留目标）。
  - 可编辑判定：`input` 的 `text/search/email/url/tel`、`textarea`、`contenteditable`；排除 `disabled`、`readonly`、隐藏、零尺寸、`type=password/file/number/date/...`。
  - `visibilitychange` / `pagehide` 时向 Service Worker 报告页面状态；页面导航由 SW 清理。
  - 收到插入消息后重新校验元素 `isConnected`、可见、可编辑，再写入。
- 写入算法：
  - `input` / `textarea`：读取 `selectionStart/selectionEnd`；构造替换后的字符串；使用原型上的原生 `value` setter 写入（绕过 React 的实例属性拦截），恢复光标位置。
  - 写入后派发冒泡的 `InputEvent('input', { inputType: 'insertText', data })` 和 `Event('change', { bubbles: true })`；`InputEvent` 不可用时回退到 `Event`。
  - `contenteditable`：先 `focus()`，优先 `document.execCommand('insertText', false, text)`；失败时用 `Range` 插入文本节点并派发 `input`。替换模式先选中全部内容。写入后比较文本是否变化，未变化则返回 `INSERT_FAILED`。
  - iframe：Content Script 注入所有 frame；SW 根据 `sender.frameId` 记录，插入时用 `chrome.tabs.sendMessage(tabId, msg, { frameId })` 精确路由。
- 焦点记录恢复：SW 被回收后内存 map 丢失。SW 启动/重连后向活动 tab 广播 `REQUEST_FOCUS_STATE`；有记录的 Content Script 通过 `runtime.sendMessage` 回报 `{ frameId, lastFocusAt }`，SW 取最新一条。恢复失败时返回 `NO_FIELD`，不猜测其他 frame。
- 多浏览器：Content Script 在窗口获得焦点/页面可见时通知 SW，SW 通过 WebSocket 发送 `page-focus`（不包含 URL）。桌面端据此选择目标连接。
- Popup：token 输入框、保存/清除、连接状态、简短配对说明；不展示页面数据。token 变化时写 `chrome.storage.local` 并通知 SW 立即重连。

### 7. 设置页与 IPC

- 设置窗口使用现有 Vue renderer，拆分为 `SettingsApp.vue` + 四个 section 组件：`GeneralSettings`（快捷键、插入模式、登录启动）、`AliasSettings`（表格 CRUD、启停、校验）、`PluginSettings`（目录、列表、错误、重载）、`ConnectionSettings`（状态、token、端口、轮换）。
- 状态管理使用轻量 composable + `reactive`，不引入 Pinia；主进程是唯一事实来源，渲染进程通过 `settings:get-state` 拉取，订阅 `settings:state-changed` 和 `connection:status-changed`。
- Preload 只暴露按领域划分的 API，不暴露原始 `ipcRenderer`：

```ts
window.api.settings.getState()
window.api.settings.updateGeneral({ hotkey, insertMode, launchAtLogin })
window.api.aliases.create/update/remove(...)
window.api.plugins.list/reload/openDirectory()
window.api.connection.getStatus()/rotateToken()
window.api.overlay.submit(text)/close()
window.api.events.onOverlayResult(cb)
```

- 主进程对每个 IPC 请求校验 `event.senderFrame` 属于已知窗口，再用 `zod` 校验载荷；失败返回结构化错误，不抛出未处理异常。
- 快捷键录制组件捕获键盘事件生成 Electron accelerator 字符串，并在保存前调用主进程试注册；冲突时不更新配置。
- 设置页修改成功后由主进程广播完整状态；别名和插件重载后立即刷新命令快照。

### 8. 应用生命周期与构建

- 单实例：`app.requestSingleInstanceLock()`；`second-instance` 事件显示设置窗口。
- 托盘：使用 `Tray`，菜单包含“设置”“重新加载插件”“退出”；macOS 使用模板图标，Windows 使用 `.ico`。新增 `resources/trayTemplate.png`（macOS）和 `resources/tray.ico`（Windows）。
- 窗口关闭：设置窗口 `close` 事件中，非退出状态调用 `event.preventDefault()` + `hide()`；托盘“退出”设置 `isQuitting = true` 后 `app.quit()`。
- 登录启动：`app.setLoginItemSettings`；启动参数带 `--hidden` 时不显示设置窗口。正常手动启动显示设置窗口（首次启动顺便引导配对）。
- 退出清理：`before-quit` 中注销快捷键、关闭 WebSocket 服务、释放插件 host、等待配置写入完成。
- 构建：
  - 桌面：沿用 `electron-vite`；renderer 增加 `overlay.html` 入口。
  - 扩展：新增 `scripts/build-extension.mjs`，用 `esbuild` 分别打包 `background.ts`（ESM）、`content.ts`（IIFE）、`popup.ts`，复制 `manifest.json`、HTML/CSS 和图标到 `dist-extension/`；`--watch` 模式供开发使用。
  - 脚本：`dev:extension`、`build:extension`、`test`、`test:e2e`。`build` 仍只构建桌面；`build:all` 同时构建扩展。
  - TypeScript：新增 `tsconfig.extension.json`（`lib: DOM`、`types: ["chrome"]`），主进程/共享代码使用 Node 配置；为 `src/shared` 增加路径别名，扩展通过 esbuild 打包共享类型。
- 扩展与桌面安装包分开分发：开发期以“加载已解压扩展”方式使用，构建产物可压缩为 zip；商店上架不在本变更内。

### 9. 安全与隐私

- Electron：`contextIsolation: true`、`nodeIntegration: false`、`webviewTag: false`；拒绝窗口导航和新窗口；渲染进程只加载本地页面（开发模式除外）。模板的 `sandbox: false` 可以保留，但 preload 不得暴露 Node API。
- IPC：校验发送窗口和载荷；设置页不能直接调用文件系统或插件加载接口之外的 Node API。
- WebSocket：回环绑定、token 鉴权、Origin 白名单、握手超时、消息大小上限、鉴权失败限速；所有消息经 schema 校验。
- 插件：JSON 基本类型边界 + `vm` 超时；文档明确“本地插件是可信代码”。插件文件大小上限 1 MiB，输出上限 10,000 字符。
- 扩展：最小权限（`storage`、`alarms` + http/https host），不读取/上传页面内容；密码字段排除；Content Script 不记录字段值；日志不含插入文本。
- 配对 token 只出现在设置页、扩展 storage 和 WS 握手中，不写入日志。

### 10. 测试策略

- **单元测试（Vitest，Node 环境）**：命令 parser（引号、转义、大小写、空输入）、resolver 优先级和冲突、内置函数参数校验、插件加载/语法错误/抛错/超时/Promise/非法返回、配置 schema/损坏恢复/迁移、协议校验、token 鉴权。
- **DOM 测试（Vitest + jsdom）**：可编辑元素判定、密码/隐藏/只读排除、input/textarea 原生 setter 与事件派发、光标/选区、替换模式、contenteditable 回退路径。
- **连接集成测试**：在随机端口启动 `ConnectionServer`，用 `ws` 假客户端验证握手、错误 token、心跳、插入请求/结果、超时和多连接选择。
- **扩展 E2E（Playwright，按需运行）**：以持久化 Chromium 上下文加载 `dist-extension`，打开本地测试表单，聚焦输入框，通过测试 WS 服务发送插入请求，断言值、`input`/`change` 事件、iframe 与多标签行为。该测试标记为 `test:e2e`，需要先构建扩展和下载浏览器；不阻塞默认单测。
- **手动验收矩阵**：Chrome/Edge × macOS/Windows；普通 input、textarea、React/Vue 受控表单、contenteditable、跨域 iframe；中文输入法；多标签/多浏览器；扩展重载/桌面重启；快捷键冲突；配置损坏；登录启动。

## Risks / Trade-offs

- **MV3 Service Worker 被回收导致插入暂时不可用** → 20 秒应用层心跳尽量保持连接，`chrome.alarms` 兜底重连；插入失败时明确报错，不静默成功。若实际环境仍频繁休眠，后续切换到 Content Script 直连或 Native Messaging。
- **本地网络访问策略（LNA）/浏览器策略变化** → 扩展 Service Worker 使用扩展权限访问回环地址，通常不受页面 LNA 提示影响；保留 Native Messaging 作为升级路径，并在发布前用目标 Chrome/Edge 版本验证。
- **`<all_urls>` 级别的 host 权限带来信任成本** → 限定 http/https、不采集页面内容、密码框排除、代码开源可审计；设置页和 README 说明权限用途。
- **`vm` 沙箱不是强安全边界** → 只加载用户本地可信插件，限制宿主对象泄漏，设置页提示插件能力；未来用 `isolated-vm`/独立进程承载不可信插件。
- **浮层在 macOS 上抢焦点后恢复不完美** → 插入不依赖系统焦点；成功后隐藏浮层并调用 `app.hide()`，必要时评估 `type: 'panel'` 或非激活面板。
- **富文本编辑器写入不稳定** → `execCommand` 优先、Range 回退，写入后校验内容变化；失败返回明确错误，不破坏页面。
- **多浏览器/多标签选错目标** → 只选最近报告页面焦点的连接；SW 内按 tab 记录最新 frame；无记录时失败而不是猜测。
- **端口扫描与 token 配对增加首次使用成本** → 设置页展示端口与 token，popup 提供粘贴和连接状态；token 可轮换。
- **扩展分发需要开发者模式加载** → v1 接受该限制，提供 zip 和图文步骤；商店发布后续处理。
- **配置或插件错误导致启动异常** → 配置损坏自动备份并回退默认值；插件错误隔离在单插件范围；快捷键/服务启动失败降级为托盘常驻并显示诊断。

## Migration Plan

本变更为 greenfield 功能，不涉及已有用户数据迁移。

1. 首次启动创建 `config.json`（v1）、生成 token、创建 `userData/plugins` 目录。
2. 后续版本通过 `version` + 迁移函数升级配置；迁移前备份原文件。
3. 开发/部署顺序：安装依赖 → 构建扩展 → 在 Chrome/Edge 加载 `dist-extension` → 启动桌面应用 → 复制 token 到扩展 popup → 验证连接和插入。
4. 回滚：移除扩展、卸载桌面应用或回退代码；配置文件和插件目录可保留，不影响旧版本启动。由于没有生产数据，无需数据回滚脚本。

## Open Questions

- 扩展最终通过 Chrome Web Store / Edge Add-ons 分发，还是长期提供 zip + 开发者模式加载？
- 是否需要在扩展断开时增加“复制结果到剪贴板”的降级操作？
- 后续是否支持 Firefox/Safari，以及是否需要把插件隔离升级为 `isolated-vm`？
