# 本地插件开发

Quick Input 的插件是放在本地插件目录中的 CommonJS 模块。插件可以提供带参数的同步命令，命令的返回值会直接成为插入到网页字段中的文本。

## 插件目录

插件目录位于 Electron `userData` 下的 `plugins` 子目录：

- macOS：`~/Library/Application Support/<应用名称>/plugins`
- Windows：`%APPDATA%\<应用名称>\plugins`

开发模式的应用名称通常是 `dihuan-quick-input`，打包版使用产品名称。以设置页的“打开目录”为准。

设置页的“插件”区域可以打开该目录。应用启动和点击“重新加载”时会扫描目录内的 `.js` 与 `.cjs` 文件（按文件名排序）。修改文件后必须点击“重新加载”，新命令才会生效。

## 最小示例

创建 `~/Library/Application Support/dihuan-quick-input/plugins/company.js`：

```js
module.exports = {
  name: 'my-plugin',
  commands: {
    company: () => '示例公司',
    greet: (args, ctx) => {
      const name = args[0] || '朋友'
      return `你好，${name}（${ctx.locale}）`
    }
  }
}
```

重启或点击“重新加载”后：

- 输入 `company` → 插入 `示例公司`
- 输入 `greet 小明` → 插入 `你好，小明（zh-CN）`

## 导出格式

插件必须通过 `module.exports` 导出一个对象：

```js
module.exports = {
  name: '插件显示名称', // 可选，缺省使用文件名
  commands: {
    // 命令名 → 同步函数
    commandName: (args, ctx) => {
      return '要插入的文本'
    }
  }
}
```

规则：

- 每个文件的 `commands` 至少包含一个命令，值必须是函数。
- 命令名不能为空或包含空白；匹配时不区分 ASCII 大小写。
- 同一个插件内规范化后重名的命令会导致该插件加载失败。
- 插件导出格式错误、语法错误或加载超时只会影响该插件，其他插件与内置命令继续可用。

## 函数参数

### `args: string[]`

命令行的其余部分会按空白切分后传入。单引号和双引号可以保留空格，反斜杠用于转义：

```text
greet "Alice Smith"   → args = ['Alice Smith']
path 'C:\Users\me'    → args = ['C:\\Users\\me']
```

命令本身不接收参数时，函数可以忽略 `args`，或自行校验 `args.length`。

### `ctx`

```ts
{
  rawArgs: string // 命令名之后的原始文本（保留引号）
  now: string // 当前时间的 ISO 8601 字符串
  locale: string // 应用区域设置，例如 zh-CN
}
```

`ctx` 和 `args` 只包含 JSON 基本类型，不会把宿主对象暴露给插件。

## 返回值

- 必须同步返回非空字符串。
- 返回 `Promise`、对象、数字、布尔值、`undefined` 或 `null` 都会产生错误，不会插入文本。
- 返回值超过 10,000 个字符会产生“命令结果过长”错误。

## 沙箱限制

插件在 Node `node:vm` 创建的独立上下文中执行：

- 不提供 `require`、`process`、`Buffer`、`setTimeout`、文件系统或网络 API。
- 脚本加载超时 1000 ms，单次命令执行超时 200 ms。
- 单个插件文件最大 1 MiB。
- 插件抛出的异常会被转换为可读错误，应用继续运行。

`vm` 不是针对恶意代码的强安全隔离。请只把信任的代码放入插件目录。若需要运行不可信插件，应改用进程隔离或 `isolated-vm` 等更强方案。

## 调试

设置页的“插件”区域会显示每个插件提供的命令和加载/执行错误。常见错误：

| 错误                     | 原因                                 |
| ------------------------ | ------------------------------------ |
| `插件加载失败：...`      | 语法错误、导出格式错误或顶层代码抛错 |
| `插件加载超时`           | 顶层代码执行超过 1000 ms             |
| `插件执行超时`           | 命令函数执行超过 200 ms              |
| `命令必须返回文本`       | 返回了非字符串或空字符串             |
| `不支持异步命令`         | 返回了 Promise                       |
| `require is not defined` | 插件尝试访问 Node 模块               |

插件文件名、错误码和耗时可能被写入诊断日志；命令结果和用户输入不会被记录。
