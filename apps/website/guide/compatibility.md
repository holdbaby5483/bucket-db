# 兼容策略

从 1.0.0 起，`@hold-baby/bucket-db` 遵循[语义化版本](https://semver.org/lang/zh-CN/)：可能让基于早期 1.x 版本编写的代码、脚本或数据失效的改动，只在新的主版本中发布。1.0 之前，次版本可以包含破坏性变更（0.4、0.5、0.6 都有，并各自附有迁移说明）。

## 受保护的范围

以下内容的破坏性改动需要新的主版本：

- **包入口（`@hold-baby/bucket-db`）的导出**：类、函数、类型及其签名。类型也算在内：原本能编译的代码不再能编译，就属于破坏性变更。关键类型由 `packages/core/tests/types/public-api.ts` 固定。
- **错误类**，以及 `StorageError.kind` 的四个取值（`not-found`、`conflict`、`transient`、`permanent`）。
- **存储适配器契约**：`get`、`put`、`delete`、`list`、`capabilities`、`remote`。自定义后端依赖它。
- **存储格式**（见[存储格式](./storage-format)）：`<dbPath>/<collection>/docs/<id>.json` 及文档内容规则。次版本和补丁版本永远不改它；任何 1.x 写入的数据，之后的每个 1.x 版本都能读取。
- **CLI**：命令名、参数、选项、输出格式（每行一个 JSON 值，`export` 输出 JSON Lines）和退出码（0 成功、1 出错、2 未找到）。
- **连接串**：scheme、查询参数，以及“URL 中不得包含凭证”这条规则。
- **[保证与限制](./guarantees)** 中列出的保证：削弱任何一条都属于破坏性变更。

## 不在保护范围内

- 从包内部路径导入的内容（`@hold-baby/bucket-db/dist/...`）。
- 错误信息和日志的文字。请按错误类和 `kind` 判断，不要匹配消息文本。
- [基准](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md)中的请求数、延迟等数字，它们可能改进，也可能随云服务变化。
- 查询快照的内容。快照可以随时丢弃：格式变化时改用新的带版本号的 key（`_snapshot.v2.json`），不同版本的客户端各用各的快照，永远不需要迁移。
- 文档中标明未验证或未测试的行为。

## 次版本中的新增

次版本可以新增导出、可选参数和选项、CLI 命令和选项、连接串参数、适配器契约中的可选成员，以及新的 `LogEvent`。基于早期 1.x 编写的代码继续可用；契约新增可选成员时，已有的自定义适配器也继续可用。

## 运行时

支持的运行时为处于 active 或 maintenance LTS 阶段的 Node.js 版本线，以及当前的 Bun。某个 Node 版本线到达生命周期终点后，在次版本中停止支持，并在 changelog 中说明；停止支持仍在上游维护期内的版本线，需要新的主版本。

## 弃用

在主版本中移除某项功能之前，会先在一个次版本中将其标记为弃用：写进 changelog 和文档，并在类型声明中加上 `@deprecated`。被弃用的功能一直可用，直到下一个主版本。
