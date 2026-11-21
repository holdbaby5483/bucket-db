# 保证与限制

适用于 0.4.0。每一行都注明了检查它的测试。测试文件位于 [`packages/core/tests/`](https://github.com/holdbaby5483/bucket-db/tree/main/packages/core/tests)；一致性测试套件（`conformance/adapter-suite.ts` "storage contract"、`conformance/collection-suite.ts` "collection"）会在[测试运行环境](#测试运行环境)中列出的每个后端上运行。

## 各后端

| 保证 | Memory | FileSystem | S3 | OSS | 检查方式 |
|---|---|---|---|---|---|
| 单次写入原子 | 是 | 是 | 是 | 是 | 每次写入是一次请求：collection D2。在任意时刻崩溃都只会留下旧状态或新状态：`core/collection-crash.test.ts`（Memory）。单次请求的原子性由后端保证：S3 / OSS 的 PUT，FileSystem 的临时文件 + `link()` / `rename()` |
| 不存在才创建（`insert`） | 是 | 是（跨进程） | 是 | 是（仅限未开启版本控制的 bucket） | Storage contract B1、B2；`core/multiprocess.test.ts`。开启版本控制的 OSS bucket 未测试 |
| 条件更新（`etag`） | 是 | 仅单进程 | 是 | 否，抛 `UnsupportedError` | Storage contract B3、B4；collection D9；`core/collection-faults.test.ts` "update throws ConcurrentUpdateError when another writer changes the document…"。OSS 拒绝：storage contract B5、collection D9 |
| 并发局部更新全部生效 | 是 | 仅单进程 | 是 | 否（后写覆盖） | Collection D10 |
| 查询结果与存储的文档一致 | 是 | 是 | 是 | 是 | Collection D4、D5、D7/D8、D13；`core/snapshot.test.ts`（见下文）。依赖 LIST 立即反映写入：storage contract A7 |

所有后端都支持多个写入进程并发执行 `insert` 和 `delete`；S3 上还支持并发 `update`（Memory 和 FileSystem 限单进程内）。`core/multiprocess.test.ts` 运行 4 个进程各插入 25 个文档，检查全部 100 个文档可见，覆盖 FileSystem、模拟 S3、CI 中的本地 S3、真实 OSS 和真实 S3。

## 查询

| 保证 | 检查方式 |
|---|---|
| `find` 恰好返回满足过滤条件的文档，包括更新之后 | Collection D4 |
| 在 LIST 与 GET 之间被删除的文档不会出现在结果中 | Collection D5 |
| `docs/` 下不是 JSON 对象的文件会让 `find` 抛出 `StorageError`，并指出 key | Collection D6 |
| 放到 `docs/` 下的 JSON 对象就是文档；`id` 和 `_etag` 来自 key 和存储服务 | Collection D7 / D8 |
| 0.3 的集合可以读取；`index/` 和 `wal/` 会被忽略 | Collection D13 |
| 不合法的名字、ID 和过滤条件在发出任何存储请求之前就被拒绝 | Collection D12 |
| `insert` 和 `delete` 各是一次请求；`findById` 是一次 GET | Collection D2 |

一致性级别：结果中的每个文档都是某个时刻已提交的版本，但整个结果集不是集合在某一时刻的快照。查询执行期间写入的文档可能在结果中，也可能不在。

## 快照（S3、OSS 及 `remote: true` 的适配器）

全部位于 `core/snapshot.test.ts` 的 "query snapshot"，使用一个声明了 `remote: true` 的内存适配器。collection 套件也会在 S3 和 OSS 上覆盖快照，因为那里的每次 `find` 都经过快照。

| 保证 | 测试 |
|---|---|
| 冷查询构建快照；热查询只做 LIST 和一次快照 GET | "a cold query builds the snapshot; a warm one reads only the list and the snapshot" |
| 只有超过 16 个文档变化时才重写快照 | "the snapshot is rewritten only when more than 16 documents changed" |
| 写入后只读取变化的文档，结果是最新的 | "after writes, only changed documents are read and the result is current" |
| 快照被删除、无法解析、结构错误或版本更新时，结果相同 | "a snapshot that is %s gives the same result"（4 种情况） |
| 已删除文档的条目、过期副本和从未存在的 ID 永远不会被使用 | "forged or stale entries are never trusted" |
| 较旧的快照覆盖较新的快照后，结果相同 | "an older snapshot written over a newer one gives the same result" |
| 快照写入失败不会让查询失败，会记录日志，401 / 403 之后不再重试 | "a failed snapshot write does not fail the query, is logged, and is not retried after a permission error" |
| 读取快照时的暂时性错误会让查询失败，而不是改为读取每个文档 | "a transient failure reading the snapshot fails the query instead of reading every document" |
| `compact()` 从快照中移除已删除文档的内容 | "compact removes the contents of deleted documents from the snapshot" |
| `compact()` 在本地后端上不写入任何东西 | "compact is a no-op on local backends" |
| 超过 10,000 个文档的集合记录一次警告；范围内的集合不记录 | "envelope warning"："a %s collection over 10,000 documents warns once"、"a collection inside the envelope does not warn" |

## S3 / OSS 客户端

`storage/s3-client.test.ts`，针对 AWS 和 OSS 两种方言的模拟 S3 服务器：

| 保证 | 测试 |
|---|---|
| 遇到 5xx、429、`SlowDown`、`RequestTimeout`、超时和连接重置时最多尝试 3 次；之后为 `kind: 'transient'` | C1–C4 |
| 403 不重试，为 `kind: 'permanent'` | C5 |
| 前一次尝试已成功的条件写入不会被报告为冲突；真正的冲突会被报告 | C6、C7 |
| 请求签名正确（SigV4） | C9 |
| 从环境变量读取区域、endpoint 和凭证；凭证提供函数在 `expiresAt` 之前刷新 | C8 |
| OSS：不存在才创建使用 `x-oss-forbid-overwrite`；`ifMatch` 不发请求直接抛 `UnsupportedError` | "S3Client over fake S3 (oss dialect)" |

## 测试运行环境

| 后端 | Storage contract + collection 套件 | 多进程 | 何时运行 |
|---|---|---|---|
| Memory | `conformance/memory.test.ts` | — | 每次 push 和 pull request |
| FileSystem | `conformance/fs.test.ts` | 是 | 每次 push 和 pull request |
| 模拟 S3（AWS 和 OSS 方言） | `conformance/fake-s3.test.ts` | 是（AWS 方言） | 每次 push 和 pull request |
| 本地 S3（SeaweedFS） | `conformance/local-s3.test.ts` | 是 | 每次 push 和 pull request |
| 真实 OSS | `conformance/real-buckets.test.ts` | 是 | 每次 push 到 `main` 和同仓库的 pull request |
| 真实 AWS S3 | `conformance/real-buckets.test.ts` | 是 | 设置了 `TEST_S3_BUCKET` 和 AWS 凭证时手动运行（暂无 CI 密钥） |

## 限制

- **没有事务。** 每次写入只涉及一个文档。
- **容量范围：每个集合最多 10,000 个文档、10 MB 快照。** 超出后查询仍然可用，但会越来越慢；集合会在每个 `Collection` 实例上记录一次警告（本地后端只检查文档数）。10,000 个文档时实测：热 `find` 在 OSS 上 1.35 秒、S3 上 3.2 秒，没有快照的查询分别为 34 秒和 134 秒。见 [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md)。
- **查询成本。** 在 S3 / OSS 上，热 `find` 是 ⌈N/1000⌉ 次 LIST + 1 次快照 GET，再加上自快照以来每个变化的文档 1 次 GET；变化超过 16 个时还会用 1 次 PUT 重写快照。在 Memory 和 FileSystem 上，每次 `find` 都读取每个文档。`{ id: '...' }` 过滤在所有后端上都只读取一个文档。`limit` 和 `offset` 不会减少读取。
- **快照包含文档内容。** 已删除文档的内容会留在 `_snapshot.v1.json` 中，直到快照被重写或执行 `compact()`。删除隐私敏感数据后请调用 `compact()`。
- **OSS 不支持条件更新。** 带 `etag` 的 `update` 抛出 `UnsupportedError`；不带 `etag` 的并发 `update` 后写覆盖。在开启版本控制的 OSS bucket 上，不存在才创建也不生效。
- **FileSystem 的条件更新仅限单进程。** `etag` 检查和并发 `update` 的合并只在同一进程的写入者之间有效。
- **结果不是某一时刻的快照。** 见上面的一致性级别。
- **0.3.x 与 0.4 不能同时写入同一集合。** 0.3 只读取自己的索引，看不到 0.4 的写入。
- **云服务中只测试了 AWS S3 和阿里云 OSS。** 其他 S3 兼容服务可以通过 `endpoint` 尝试使用；CI 中用 SeaweedFS 作为本地替代。
- **OSS 上 LIST 的写后读一致性是观察结果，而非承诺。** AWS 文档承诺 LIST 强一致；对 OSS，storage contract A7 持续在真实服务上检查。
