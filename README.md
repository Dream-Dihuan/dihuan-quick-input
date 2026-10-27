# Dihuan Quick Input

一个本地优先的桌面快速输入助手：按下全局快捷键，在浮层里输入短命令（例如 `name`、`age 19`），解析后的文本会写入当前网页中聚焦的输入框。

它由两部分组成：

- **Electron 桌面应用**：全局快捷键、输入浮层、命令解析、静态映射、插件和设置页。
- **Chrome / Edge 扩展**：跟踪当前网页焦点字段，并把桌面应用发来的文本写入 DOM。

> 当前版本面向 macOS 与 Windows 的 Chrome / Edge。Firefox、Safari、Linux 和浏览器商店上架不在本版本范围内。

## 功能

- 全局快捷键默认 `CommandOrControl+Shift+Space`，可在设置页录制新的组合键。
- 静态命令映射，例如 `name → 张三`。
- 内置函数命令：`age`、`date`、`time`、`uuid`、`upper`、`lower`。
- 本地 CommonJS 插件，可添加带参数的同步命令，并在不重启应用的情况下重新加载。
- 支持普通 `input`（`text` / `search` / `email` / `url` / `tel`）、`textarea` 和 `contenteditable`。
- 支持 iframe（包括跨域 iframe）和多标签页；只在当前活动标签页中聚焦字段时写入。
- 配对令牌、token 轮换、连接状态和错误诊断均在本地设置页完成。
- 连接只监听 `127.0.0.1`，不向外部网络暴露服务。

## 环境要求

- Node.js 20+（开发建议使用当前 LTS）
- pnpm 9+
- macOS 12+ 或 Windows 10/11
- Chrome 116+ 或 Edge 116+

## 从零开始

### 1. 安装依赖

```bash
corepack enable
pnpm install
```

### 2. 构建扩展并启动桌面应用

```bash
pnpm build:extension
pnpm dev
```

`pnpm dev` 会启动 Electron 桌面应用。扩展需要单独构建到 `dist-extension/`，然后在浏览器中加载。

开发扩展时可以另开一个终端运行：

```bash
pnpm dev:extension
```

修改扩展代码后，还需要在浏览器的扩展管理页点击“重新加载”，页面也需要刷新。

### 3. 在浏览器中加载扩展

Chrome：

1. 打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择仓库中的 `dist-extension` 目录。
4. 建议把扩展固定到工具栏，方便打开配对弹窗。

Edge：

1. 打开 `edge://extensions`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择 `dist-extension`。
4. 固定扩展图标。

### 4. 配对扩展

1. 桌面应用首次启动会显示设置页和引导。
2. 在“浏览器连接”区域复制“配对令牌”。
   - 如果应用已经关闭了设置窗口，可以从托盘/菜单栏图标选择“设置”。
3. 打开浏览器中的扩展弹窗，把令牌粘贴到输入框并点击“保存”。
4. 连接成功后，设置页会显示浏览器名称、扩展版本和端口；扩展弹窗也会显示“已连接”。

### 5. 完成一次插入

1. 在网页中点击一个文本输入框，让它获得焦点。
2. 按下全局快捷键，浮层出现。
3. 输入命令，例如 `name` 或 `age 19`，按 Enter。
4. 解析结果会写入刚才聚焦的输入框，浮层自动隐藏。

## 命令

### 语法

- 第一个词是命令名，其余部分按空白拆分为参数。
- 支持单引号和双引号保留空格，反斜杠用于转义。
- 命令名匹配不区分 ASCII 大小写。
- 空输入不会提交。

示例：

```text
name
age 19
upper "hello world"
greet "Alice Smith"
```

### 内置命令

| 命令              | 说明                           |
| ----------------- | ------------------------------ |
| `age <整数>`      | 返回 `<整数> 岁`；要求非负整数 |
| `date`            | 本地日期，例如 `2026-10-27`    |
| `time`            | 本地时间，例如 `17:30`         |
| `uuid`            | 随机 UUID                      |
| `upper <文本...>` | 转为大写                       |
| `lower <文本...>` | 转为小写                       |

### 静态映射

在“命令映射”区域新增条目，例如：

- 命令名：`name`
- 映射文本：`张三`

保存后立即生效。静态映射优先于同名插件和内置命令；静态映射不接受参数，输入 `name extra` 会返回错误而不会插入文本。命令名在比较时不区分大小写。

### 本地插件

插件放在桌面应用用户数据目录下的 `plugins/` 中。最准确的方式是在设置页“插件”区域点击“打开目录”，然后放入 `.js` 或 `.cjs` 文件。

最小示例：

```js
module.exports = {
  name: 'my-plugin',
  commands: {
    company: () => '示例公司',
    greet: (args) => `你好，${args[0] || '朋友'}`
  }
}
```

点击设置页的“重新加载插件”后即可使用。插件函数必须同步返回非空字符串；Promise、数字、对象和空字符串会被拒绝。

插件命令的优先级为：**静态映射 > 插件 > 内置函数**。完整接口、参数、上下文和沙箱限制见 [docs/plugins.md](docs/plugins.md)。

## 设置说明

设置页包含四个区域：

- **常规**：录制全局快捷键、选择插入方式、开启/关闭登录启动。
- **命令映射**：新增、编辑、启用/停用和删除静态映射。
- **插件**：查看插件目录、插件命令、错误信息，打开目录或重新加载。
- **浏览器连接**：端口、配对令牌、复制/轮换令牌、已连接浏览器和最近连接错误。

插入方式：

- **在光标处插入**：保留字段原内容，在当前选区位置写入；有选区时替换选区。
- **替换字段内容**：先清空整个字段再写入。

关闭设置窗口不会退出应用；应用会继续在托盘/菜单栏运行。通过托盘菜单的“退出”才会结束快捷键、本地连接和后台进程。

## 登录启动

在设置页开启“登录时启动”后，应用会使用系统登录项启动，并保持后台运行，不自动弹出设置窗口。

- macOS 通过登录项启动时会检测 `wasOpenedAtLogin` 并隐藏 Dock/设置窗口。
- Windows 登录项会带 `--hidden` 参数启动，隐藏设置窗口。

登录启动和系统权限行为受操作系统设置影响；如果系统拒绝修改，设置页会显示错误并保留旧设置。

## 支持范围与限制

网页字段：

- 支持：`input[type=text|search|email|url|tel]`、`textarea`、`contenteditable`。
- 排除：`password`、`number`、`file`、`date`、`checkbox`、`radio` 等非文本控件；也会排除禁用、只读、隐藏、不可见或已从文档移除的字段。
- `contenteditable` 采用 `execCommand` 优先、Range 回退的尽力而为写入。复杂的 ProseMirror、Lexical、Quill 等编辑器不保证完整语义。
- 跨域 iframe 由扩展注入到每个 frame，并按 `sender.frameId` 精确路由。
- 只对当前活动标签页操作；浮层抢走浏览器焦点时会保留最后一个可编辑字段，并在写入前重新聚焦，不会向其他标签页插入。

应用限制：

- 不向浏览器以外的桌面应用注入文本。
- 不采集或上传页面内容；扩展只记录可编辑元素和焦点时间。
- 不包含自动更新、账号或云同步。
- 扩展安装采用开发者模式加载，当前不通过应用商店分发。

## 隐私与安全

### 本地连接

- 桌面应用 WebSocket 服务只绑定 `127.0.0.1`。
- 端口范围为 `47821`–`47830`，使用第一个可用端口。
- 扩展必须提供配对令牌，桌面应用只接受 `chrome-extension://` Origin。
- 握手、消息大小、消息结构和插入请求均有校验；插入请求有超时。
- 配对令牌不会写入日志。

### 浏览器扩展权限

- `storage`：保存配对令牌。
- `alarms`：Service Worker 被浏览器回收后兜底重连。
- `http://*/*`、`https://*/*` host 权限：向网页注入 Content Script，以跟踪焦点并写入字段。
- Content Script 注入所有 frame（包括 `about:blank` 子 frame），不读取字段内容用于上传。

### 桌面应用

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webviewTag: false`。
- 生产构建关闭 DevTools；拒绝窗口内导航和新窗口，外链交给系统浏览器。
- 设置页和浮层通过领域化 preload API 访问主进程，不暴露原始 `ipcRenderer`。
- 配置文件使用原子写入；Unix 下权限为 `0600`。
- 插件是用户主动放入本地目录的可信代码。`node:vm` 提供有限隔离和执行超时，**不是**针对恶意代码的强安全边界。

## 数据目录

桌面应用使用 Electron 的 `userData` 目录。设置页“插件”区域的“打开目录”会直接打开准确位置。

典型位置：

- macOS：`~/Library/Application Support/<应用名称>/`
- Windows：`%APPDATA%\<应用名称>\`

其中：

- `config.json`：配置、别名、配对令牌和引导状态。
- `plugins/`：本地插件目录和说明文件。
- `config.corrupt-<timestamp>.json`：配置损坏时的备份文件（如果发生过恢复）。

开发模式和打包版的应用名称可能不同；以设置页显示和“打开目录”为准。

## 开发与测试

```bash
# 类型检查
pnpm typecheck

# ESLint
pnpm lint

# 单元测试（Vitest）
pnpm test

# 构建扩展
pnpm build:extension

# 构建扩展 + 桌面应用 + 扩展 zip
pnpm build:all

# 扩展 Playwright E2E（需要先安装 Chromium）
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e` 会以有头 Chromium 持久化上下文加载 `dist-extension`，通过测试 WebSocket 服务发送插入请求，覆盖输入框、contenteditable、跨域 iframe、非活动标签页、浏览器窗口失焦后保留最后焦点字段，以及错误 token 的 popup 流程。它需要图形环境；在无显示器的 CI 中需要虚拟显示（例如 Xvfb）。

桌面 E2E/手工验收项目见 [docs/manual-test.md](docs/manual-test.md)。

## 构建与分发

```bash
# 桌面应用 + 扩展
pnpm build:all

# macOS 安装包（同时生成扩展 zip）
pnpm build:mac

# Windows 安装包（在 Windows 或可用的交叉构建环境执行）
pnpm build:win
```

产物：

- `out/`：Electron 主进程和 renderer 构建产物。
- `dist-extension/`：可直接在 Chrome/Edge 开发者模式加载的扩展目录。
- `release/dihuan-quick-input-extension-<version>.zip`：可分发扩展压缩包。
- `release/`：electron-builder 生成的桌面安装包/应用。

macOS 构建默认不签名、不公证（`notarize: false`）；首次打开未签名应用时可能需要在系统设置中允许。Windows 构建需要在可用环境验证并记录结果。

## 常见问题

### 设置页显示“等待浏览器连接”

1. 确认桌面应用正在运行，且没有通过托盘菜单退出。
2. 在扩展弹窗确认已填入与设置页一致的令牌。
3. 检查端口是否在 `47821`–`47830` 内；如果全部被占用，应用会在设置页显示连接错误。
4. 修改令牌后重新打开扩展弹窗保存；扩展会自动重连。
5. 如果仍然失败，在 `chrome://extensions` 或 `edge://extensions` 重新加载扩展，并刷新目标网页。

### 按快捷键没有出现浮层

1. 确认桌面应用仍在运行；关闭设置窗口只会隐藏窗口，应用应继续在托盘/菜单栏中。
2. 浮层会出现在**鼠标指针所在的显示器**。多显示器时，把鼠标移到目标屏幕后再按快捷键。
3. 如果设置页刚从后台唤出，macOS 可能需要一点时间完成窗口激活；稍等片刻或再按一次快捷键。
4. 如果快捷键被其他应用占用，尝试在设置页录制另一个组合键。

### 快捷键冲突

设置页保存快捷键前会先尝试注册。如果组合键被系统或其他应用占用，会显示错误，旧快捷键继续有效，冲突值不会写入配置。录制时按 Escape 可取消。

### 浮层提示“无法确定目标浏览器”或“没有聚焦的可编辑字段”

浮层打开后，浏览器窗口失去 OS 焦点是正常现象；扩展会保留你刚才聚焦的字段，并在写入前重新聚焦。如果仍提示无法插入，请检查：

- 在按快捷键之前，先在普通网页中点击一个文本输入框，让它获得焦点。
- 目标字段是受支持的文本控件，不是密码、数字、文件或非文本控件。
- 字段没有被禁用、只读或隐藏。
- 当前页面是 `http://` / `https://` 普通网页，不是 `chrome://`、扩展商店、PDF 查看器等不会注入 Content Script 的页面。
- 扩展加载在**当前浏览器窗口/用户配置**中，并且扩展弹窗显示已连接到桌面应用。
- 重新加载扩展后刷新目标网页，让最新 Content Script 生效。

### 网页里内容没有变化

- `contenteditable` 编辑器可能不受支持；应用会在写入前后比较文本，如果无法改变内容会返回失败。
- 复杂富文本编辑器可能阻止 `execCommand` 或替换 DOM；请使用普通输入框，或查看设置页/浮层中的错误信息。

### 配置损坏

应用启动时会校验 `config.json`。损坏时会把原文件备份为 `config.corrupt-<timestamp>.json`，使用安全默认值启动，并在设置页显示恢复提示和备份路径。重新配对并检查命令映射即可恢复使用。

### 如何完全退出

从 macOS 菜单栏或 Windows 托盘图标的菜单选择“退出”。关闭设置窗口只会隐藏窗口，应用仍在后台运行。

## 更多文档

- [插件开发](docs/plugins.md)
- [手工验收矩阵](docs/manual-test.md)
- [OpenSpec 变更](openspec/changes/add-quick-input-assistant/proposal.md)
