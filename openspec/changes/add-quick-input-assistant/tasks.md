# Tasks

## 1. 项目基础与构建骨架

- [x] 1.1 添加运行时依赖 `ws`、`zod`、`write-file-atomic`，以及开发依赖 `@types/ws`、`vitest`、`jsdom`、`@vue/test-utils`、`esbuild`、`@types/chrome`、`@playwright/test`，并在 `package.json` 增加 `test`、`test:e2e`、`build:extension`、`dev:extension`、`build:all` 脚本；验证：`pnpm install` 成功且 lockfile 更新。
- [x] 1.2 新建 `src/shared/`，定义协议消息、配置、IPC 请求/响应和错误码类型，并用 `zod` 编写运行时校验 schema；更新 `tsconfig.node.json` / `tsconfig.web.json` 的 include 与路径别名；验证：`pnpm typecheck` 通过。
- [x] 1.3 为 electron-vite 配置设置页与浮层双 renderer 入口，新增 `src/renderer/overlay.html`、`src/renderer/src/overlay/main.ts` 和占位 `OverlayApp.vue`；验证：`pnpm build` 后 `out/renderer/index.html` 与 `out/renderer/overlay.html` 均存在。
- [x] 1.4 新建 `extension/` 目录、MV3 `manifest.json`、`background.ts` / `content.ts` / `popup.ts` 占位文件、`scripts/build-extension.mjs` 与 `tsconfig.extension.json`；验证：`pnpm build:extension` 生成 `dist-extension/manifest.json`、`background.js`、`content.js`、`popup.html`。
- [x] 1.5 配置 Vitest（Node 与 jsdom 两套环境）并添加一个 shared schema 冒烟测试；验证：`pnpm test` 可执行且冒烟测试通过。

## 2. 命令引擎

- [x] 2.1 实现命令解析器 `parser.ts`，支持空白拆分、单双引号、反斜杠转义、ASCII 大小写不敏感和空输入；验证：解析器单元测试覆盖 `name`、`age 19`、`greet "Alice Smith"`、`NAME` 与空白输入并通过。
- [x] 2.2 实现内置函数 `age`、`date`、`time`、`uuid`、`upper`、`lower`，包含参数数量与格式校验；验证：每个内置函数的成功与非法参数测试通过。
- [x] 2.3 实现命令注册表与解析器，落地“静态别名 > 插件 > 内置函数”的优先级、禁用别名、同名冲突检测和别名拒绝参数；验证：优先级、冲突和错误路径单元测试通过。
- [x] 2.4 实现插件 host：扫描插件目录、CommonJS 包装、`node:vm` 执行、JSON 基本类型参数边界、加载/执行超时、输出长度限制和单插件错误隔离；验证：有效插件、语法错误、抛错、死循环、`require` 访问和 Promise 返回测试均通过。
- [x] 2.5 实现统一命令错误模型与结果规范化，确保未知命令、非法参数、插件错误、超时、空结果和非字符串结果都不会产生可插入文本；验证：resolver 错误码与“无插入结果”测试通过。
- [x] 2.6 编写 `docs/plugins.md` 与插件目录 `README.md`，说明插件导出格式、参数、上下文、沙箱限制和示例；验证：按文档创建临时插件后，对应命令测试通过。

## 3. 配置与持久化

- [x] 3.1 实现配置 schema、默认值（默认快捷键、插入模式、token 生成、别名空列表）和版本迁移入口；验证：默认配置、非法字段和 token 唯一性单元测试通过。
- [x] 3.2 实现配置仓库：读取、`zod` 校验、`write-file-atomic` 写入、损坏文件备份、默认值回退和 Unix `0600` 权限；验证：损坏 JSON、部分字段非法、重启后保留配置的单元测试通过。
- [x] 3.3 实现首次启动初始化：创建用户配置、插件目录和目录说明文件，并暴露给主进程服务；验证：在临时 `userData` 目录中调用初始化后文件存在且内容正确。

## 4. 本地连接与协议

- [x] 4.1 实现 `ConnectionServer`：只绑定 `127.0.0.1`、端口 `47821`–`47830` 扫描、握手超时、token 恒定时间比较、Origin 白名单和消息 schema 校验；验证：集成测试覆盖正确 token、错误 token、非扩展 Origin 和端口占用回退。
- [x] 4.2 实现应用层心跳、连接断开清理、扩展重连状态和插入请求/结果关联；验证：假客户端测试覆盖 `ping/pong`、3 秒插入超时、迟到结果忽略和断开后状态更新。
- [x] 4.3 实现多客户端 `page-focus` 时间戳与目标连接选择，确保只向最近活动的连接发送插入请求，无活动连接时返回明确错误；验证：两个假客户端场景测试通过。
- [x] 4.4 实现 token 轮换与连接状态广播：轮换后断开旧连接、刷新设置页状态并拒绝旧 token；验证：集成测试和设置页手动检查通过。

## 5. 桌面壳、快捷键与浮层

- [ ] 5.1 实现单实例锁、托盘图标/菜单、设置窗口关闭隐藏、托盘退出标志与 `before-quit` 清理；验证：手动启动两次只出现一个实例，关闭设置窗口后快捷键仍可用，托盘退出后进程结束。
- [ ] 5.2 实现快捷键管理器：默认 `CommandOrControl+Shift+Space`、先注册新键再注销旧键、冲突返回错误、退出时注销；验证：快捷键工具函数测试通过，并在 macOS 手动验证冲突组合不会被保存。
- [x] 5.3 实现浮层窗口创建、光标所在显示器定位、置顶/全工作区、显示/隐藏/聚焦和失焦关闭；验证：手动在多显示器或不同位置唤起浮层，位置与焦点符合预期（2026-10-27 真实快捷键、多显示器和失焦关闭通过；全屏覆盖未单独手测）。
- [ ] 5.4 实现浮层 Vue UI：输入框自动聚焦、Enter 提交、Escape 关闭、组合输入法保护、提交中防重复、成功/错误状态展示；验证：`@vue/test-utils` 覆盖组合状态 Enter 与错误展示，中文输入法手动验证通过。
- [x] 5.5 串联浮层提交到命令引擎、连接服务与结果回传，成功隐藏、失败保持打开；验证：使用假连接服务的手动/集成测试覆盖成功、未知命令、扩展未连接三种路径。
- [ ] 5.6 实现登录启动设置与 `--hidden` 启动行为，macOS/Windows 使用对应登录项参数；验证：macOS 手动开启/关闭登录项，登录启动时不显示设置窗口。
- [ ] 5.7 加固桌面窗口安全：`contextIsolation`、禁用 Node/webview、拒绝外部导航和新窗口，并只暴露领域化 preload API；验证：安全配置检查与手动点击外链测试通过。

## 6. 设置页与 IPC

- [x] 6.1 实现类型化 IPC 处理器、发送窗口校验、`zod` 载荷校验和 preload API；验证：非法载荷被拒绝，合法请求单元测试通过。
- [x] 6.2 实现设置页布局与四个 section（常规、命令映射、插件、扩展连接），接入状态拉取和实时更新；验证：`pnpm dev` 设置页可打开，四个区域显示当前状态。
- [ ] 6.3 实现常规设置：快捷键录制/试注册、插入模式切换、登录启动开关，保存成功后立即生效；验证：修改快捷键与插入模式后重启应用仍保留，冲突快捷键不落盘。
- [x] 6.4 实现别名 CRUD 与校验：命令名非空/无空白/大小写不敏感唯一、映射文本非空、启停与删除；验证：重复名、空值、禁用和新增后立即解析的测试/手动检查通过。
- [x] 6.5 实现插件面板：显示目录、插件列表、命令列表、错误信息、打开目录与重新加载；验证：临时插件语法错误时页面显示错误，修复并重载后命令可用。
- [x] 6.6 实现扩展连接面板：连接状态、浏览器信息、端口、token 复制与轮换、最近错误实时刷新；验证：启动/停止扩展和轮换 token 时状态与提示正确变化。
- [x] 6.7 实现首次启动引导：提示安装扩展、复制 token、打开插件目录和设置快捷键；验证：删除配置后首次启动显示引导，完成标记后再次启动不再重复。

## 7. 浏览器扩展

- [ ] 7.1 完成 MV3 清单、Service Worker、Content Script、Popup 基础结构和图标资源，确保构建产物可直接加载；验证：Chrome/Edge 开发者模式加载 `dist-extension` 无清单错误。
- [x] 7.2 实现 Service Worker 的 WebSocket 客户端：读取 token、扫描端口、握手、20 秒心跳、关闭后退避重连和 `chrome.alarms` 兜底；验证：用假 WebSocket 服务测试握手、鉴权失败、重连与心跳。
- [x] 7.3 实现 Content Script 焦点跟踪与可编辑元素判定：支持 text/search/email/url/tel、textarea、contenteditable，排除密码/隐藏/只读/禁用控件，并处理 tab 与页面生命周期；验证：jsdom 单元测试覆盖支持列表和排除列表。
- [x] 7.4 实现 input/textarea 写入：光标插入、选区替换、替换整个字段、原生 value setter、`input`/`change` 事件和光标恢复；验证：单元测试断言值、事件类型、冒泡和选区。
- [x] 7.5 实现 contenteditable 写入：`execCommand` 优先、Range 回退、替换模式、写入后变化校验和失败返回；验证：模拟 `execCommand` 成功/失败路径的单元测试通过。
- [x] 7.6 实现 iframe 路由：所有 frame 注入、按 `sender.frameId` 记录、插入消息精确发送、无记录时返回错误；验证：手动在跨域 iframe 表单中插入成功，顶层页面不被修改。
- [ ] 7.7 实现页面焦点上报与多浏览器选择：Content Script 在窗口聚焦/可见时通知 SW，SW 通过 WebSocket 发送 `page-focus`，桌面端只选最近连接；验证：Chrome 与 Edge 同时连接时只写入最近聚焦的浏览器。
- [x] 7.8 实现 Popup：token 输入/清除、保存到 `chrome.storage.local`、连接状态和配对说明；验证：修改 token 后 SW 立即重连，错误 token 显示失败提示。
- [x] 7.9 添加 Playwright 扩展 E2E：加载 `dist-extension`、打开本地测试页、聚焦输入框、通过测试 WS 服务发送插入请求并断言值与事件；验证：`pnpm test:e2e` 通过（需先构建扩展并安装浏览器）。

## 8. 集成、文档与打包

- [ ] 8.1 在 macOS 上完成 Chrome/Edge 手工矩阵：普通 input、textarea、React/Vue 受控表单、contenteditable、跨域 iframe、中文输入法、多标签/多浏览器、扩展重载、桌面重启；验证：矩阵结果记录在 `docs/manual-test.md`，失败项已修复或有明确说明。
- [ ] 8.2 更新 `README.md`，包含桌面安装/开发、扩展加载、token 配对、插件开发、权限与隐私说明、常见故障排查；验证：按 README 从零执行命令可以完成一次插入。
- [x] 8.3 完成打包配置：托盘图标、应用标识、扩展 zip 脚本，并验证 `pnpm build:mac` 与 `pnpm build:all` 产出桌面应用和可分发扩展压缩包；Windows 构建在可用环境验证并记录结果。
- [x] 8.4 执行最终检查：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`openspec validate add-quick-input-assistant --strict` 全部通过；修复发现的问题并记录结果。

## Workflow follow-up

- 实现完成后等待用户发起 `/opsx-apply` 流程，不要在本规划阶段开始改代码。
- 实现、评审与手工验收通过后，按项目流程归档该变更。

## Verification notes (2026-10-27)

- 自动化：`pnpm typecheck`、`pnpm lint`、131 个单元/DOM 测试（21 个测试文件）、4 个 Playwright E2E、`pnpm build:all`、`pnpm build:mac` 和 `openspec validate --strict` 均通过；打包应用启动与设置页冒烟通过。E2E 新增“浏览器窗口失焦后仍向最后聚焦字段插入”场景。
- 真实桌面 + 扩展：使用 Playwright Chromium 与真实 Electron 服务完成配对、设置页连接显示、input/textarea/contenteditable 插入；该插入冒烟仍由主进程调试钩子唤起浮层，不等同于真实全局快捷键。
- 真实 Chrome 端到端（2026-10-27）：修复 Content Script 在浏览器被浮层抢焦点后丢失最后可编辑字段的问题；插入前重新聚焦目标并写入。用户在真实 Chrome 156 的本地测试页点击文本框后，用真实 `Cmd+Shift+Space` 输入 `name`，测试页成功写入，浮层隐藏；`lastPageFocusAt` 有值且无运行时错误。
- 真实全局快捷键回归（2026-10-27）：修复浮层“已显示但未聚焦时再次按快捷键会被隐藏”、macOS 初次失焦立即关闭，以及设置窗口可见时异步抢焦点的问题（显示后约 250ms 重试聚焦）后，重启开发应用、关闭设置窗口（Dock 隐藏），用户在鼠标所在显示器按 `Cmd+Shift+Space`，浮层正常出现并可输入；切回其他窗口后浮层按失焦逻辑隐藏，Dock 保持隐藏。多显示器定位分别在主屏/副屏验证。覆盖测试见 `tests/node/app/overlay-behavior.test.ts`。
- 打包：macOS arm64 产出 app、dmg、zip；未签名、未公证；Windows 环境不可用，未执行 Windows 构建。
- 待手工验收项：托盘菜单/退出、macOS 快捷键冲突识别、全屏应用上的浮层覆盖、真实中文输入法、登录启动、外链点击、Edge 开发者模式加载、Chrome+Edge 双浏览器选择、完整 8.1 矩阵和从零 README 全局快捷键流程。详见 `docs/manual-test.md`。
