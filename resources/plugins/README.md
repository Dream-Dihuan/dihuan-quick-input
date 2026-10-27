# Quick Input 插件目录

把信任的 `.js` / `.cjs` 插件放在此目录，然后在桌面应用设置页的“插件”区域点击“重新加载”。

最小插件：

```js
module.exports = {
  name: 'my-plugin',
  commands: {
    company: () => '示例公司',
    greet: (args) => `你好，${args[0] || '朋友'}`
  }
}
```

- 命令必须同步返回非空字符串；返回 Promise、数字、对象或空字符串会报错。
- 函数签名：`(args: string[], ctx: { rawArgs: string, now: string, locale: string }) => string`。
- 沙箱不提供 `require`、`process`、文件系统或网络访问；加载超时 1000 ms，执行超时 200 ms。
- 插件是用户主动放入并信任的本地代码，`vm` 不是恶意代码的强隔离方案。
- 完整契约与示例见应用仓库中的 `docs/plugins.md`。
