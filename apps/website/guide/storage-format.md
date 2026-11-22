# 存储格式

BucketDB 0.4 至 0.6 会向你的 bucket 或目录写入什么（0.5 和 0.6 都没有改变格式），以及其他读取者或写入者必须遵守的规则。所有后端使用相同的布局，只有 S3 和 OSS 额外有一个快照。

## Key 布局

```
<dbPath>/
  <collection>/
    docs/
      <id>.json            # 每个文档一个对象
    _snapshot.v1.json      # 仅 S3 / OSS：查询快照，可随时删除
```

- `<dbPath>` 是传给 `new BucketDB(adapter, dbPath)` 的前缀，或连接 URL 的路径部分（`s3://bucket/<dbPath>`，见 `BucketDB.connect`），可以包含 `/`（如 `tenants/a`）。`dbPath = ''` 时集合位于 bucket 根目录：`<collection>/docs/<id>.json`。
- 在 `FileSystemAdapter` 上，每个 key 是 `basePath` 下的文件路径。`MemoryStorageAdapter` 在内存中使用相同的 key。
- 快照位于 `docs/` 旁边而不是其中，因此永远不会出现在文档列表里。

除此之外不写任何东西：没有索引、没有日志、没有元数据对象。唯一的例外是 `bucket-db doctor`（见[命令行 · doctor](/guide/cli#doctor)）：它在 `<dbPath>/_doctor-<unix 毫秒>/` 下写入测试对象（`dbPath` 为 `''` 时是根目录下的 `_doctor-<time>/`），并在退出前删除，检查失败时也会删除。它的 key 都不在任何 `docs/` 目录下，因此不会被任何集合读到。如果进程中途被杀掉，可以直接删除残留的 `_doctor-…/` 前缀。

## 命名

集合名、文档 ID 以及 `dbPath` 中每个以 `/` 分隔的段，都必须是 1–255 个 `A-Z a-z 0-9 _ - .` 字符（`^[A-Za-z0-9_.-]{1,255}$`），且不能以 `.` 开头。其他名字会被拒绝并抛出 `ValidationError`；BucketDB 从不改写名字。`insert` 在没有传 `{ id }` 时用 `crypto.randomUUID()` 生成 ID；`put` 的 ID 总是由调用方给出。

## 文档：`docs/<id>.json`

对象内容是一个 UTF-8 JSON 对象。BucketDB 写入：

```json
{
  "name": "Alice",
  "id": "0b6c1f3e-5a7d-4e8b-9c1a-2f3d4e5f6a7b",
  "_createdAt": "2026-11-21T08:00:00.000Z",
  "_updatedAt": "2026-11-21T08:00:00.000Z"
}
```

规则：

- **key 决定 ID。** 每次读取时，`id` 都取自 key 中的 `<id>`，不管内容里写的是什么。BucketDB 会把 `id` 写进内容，但从不读回它。
- **存储服务决定 etag。** `_etag` 是服务返回的 ETag（去掉引号）；它从不存入内容，内容里的 `_etag` 会被忽略。
- **系统字段。** `_createdAt` 和 `_updatedAt` 是 ISO 8601 时间戳。`insert` 和 `put` 把两者都设为当前时间（`put` 不读取旧文档，所以被替换的文档会得到新的 `_createdAt`）；`update` 保留 `_createdAt`，更新 `_updatedAt`。`find` 的默认顺序是 `_createdAt`、再 `id`。没有这两个字段的内容仍是合法文档，只是读出时没有这些字段，默认顺序下排在最后。
- **任何 JSON 对象都是文档。** 通过其他方式放到 `docs/<id>.json` 的文件，会像 BucketDB 写入的一样被读取。
- **`docs/` 下的其他东西都是错误。** 名字不是 `<合法 ID>.json`，或内容不是 JSON 对象，会让 `find` 抛出 `StorageError`，`key` 指向该对象。以 `.` 开头的名字（如 `.DS_Store`）会被跳过。`FileSystemAdapter` 还会跳过自己的 `*.tmp` 写入临时文件和 0.3 的 `*.meta` 文件。

每次写入都是针对一个文档对象的一次请求：`insert` 是不存在才创建的 PUT，`put` 是无条件 PUT，`update` 是一次 GET 加一次（在支持的后端上为条件）PUT，`delete` 是一次 DELETE。`deleteMany` 是一次 `find` 加上每个匹配文档一次 DELETE。

## 由其他工具写入文档

因为 key 决定 ID、任何 JSON 对象都是文档，其他程序可以直接写入文档：把一个 JSON 对象 PUT 到 `<dbPath>/<collection>/docs/<id>.json` 即可。如果希望文档在默认顺序中处于正确位置，请写入 `_createdAt`（ISO 8601）。

`bucket-db import`（见[命令行 · 导出与导入](/guide/cli#导出与导入)）正是这样做的：每个带字符串 `id` 的 JSON 行，用一次无条件 PUT 写成 `docs/<id>.json` 的内容，`id`、`_createdAt`、`_updatedAt` 和其他字段原样保留，`_etag` 被去掉。因此 `bucket-db export | bucket-db import` 可以连同 ID 和时间戳一起恢复集合。没有 `id` 的行走 `insert`。

## 快照：`_snapshot.v1.json`

只在远程后端上保留：`S3Adapter`、`OSSAdapter`，以及声明了 `remote: true` 的自定义适配器。它的作用是让查询不必 GET 每一个文档。它是缓存，从来不是数据来源。

```json
{
  "format": "bucket-db-snapshot",
  "version": 1,
  "documents": {
    "0b6c1f3e-5a7d-4e8b-9c1a-2f3d4e5f6a7b": {
      "etag": "9a0364b9e99bb480dd25e1f0284c8555",
      "body": { "name": "Alice", "_createdAt": "2026-11-21T08:00:00.000Z", "_updatedAt": "2026-11-21T08:00:00.000Z" }
    }
  }
}
```

- `documents` 把每个文档 ID 映射到被复制版本的 etag，以及该版本去掉 `id` 和 `_etag` 后的内容。
- 整个文件是一个 UTF-8 JSON 对象，大小约等于集合中所有文档的总大小（10,000 个约 450 字节的文档为 5.2 MB，见 [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md)）。

### 读取者的规则

读取者必须把快照当作提示，把 `docs/` 的 LIST 当作权威：

1. LIST `<dbPath>/<collection>/docs/`，得知有哪些文档及其 etag。
2. **只有当快照条目的 etag 等于 LIST 报告的** `docs/<id>.json` 的 etag 时才使用该条目。其他列出的文档逐个 GET。
3. 忽略 ID 不在列表中的条目（已删除的文档）和格式错误的条目。
4. 文件不是合法 JSON、`format` 不同、`version` 不是 `1`，或 `documents` 不是对象时，视为快照不存在。

按这些规则读取，缺失、过期、损坏、版本不同或被并发覆盖的快照只会改变查询需要多少次 GET，永远不会改变结果。

### BucketDB 何时写入快照

- 当查询需要逐个 GET 的文档数（新增、修改或快照中缺失的）加上快照中已删除文档的条目数超过 16 时，查询会重写快照。不超过 16 时快照保持不变，因此 16 个文档以内的集合可能永远不会有快照。
- `collection.compact()` 用所有当前文档重建快照。
- 写入是无条件 PUT。并发写入者可能互相覆盖，甚至用较旧的副本覆盖；由于上面的 etag 规则，读取者不受影响。
- 如果凭证没有写权限（401 / 403），该集合会停止尝试写入，所有查询照常工作，代价是被修改的文档需要逐个读取。

快照包含完整的文档内容。已删除文档的内容会留在快照中，直到下一次重写或 `compact()`。对 `docs/` 下对象设置过期的生命周期规则可以当作 TTL 使用：过期的文档会从 LIST 中消失，因此也会从查询结果中消失。

## 0.3 遗留文件

0.3 在 `docs/` 旁边保留 `index/` 和 `wal/` 目录，`FileSystemAdapter` 还在每个文档旁写入 `*.meta` 文件。0.4 及以后的版本从不读取它们：只列出 `docs/`，只读取上面的快照 key。它们可以删除。文档对象本身格式相同，因此 0.4 及以后的版本无需转换即可读取 0.3 的集合。详见[升级指南](./migration)。

## 兼容性承诺

- 文档布局（`docs/<id>.json` 及上面的内容规则）与 0.3 使用的相同。改变它属于破坏性变更，会在 changelog 中列出并附迁移步骤。
- 快照可随时丢弃。快照格式的变化会使用新的带版本 key（`_snapshot.v2.json`）；不同版本的客户端各自维护快照，从不读取对方的快照。无需迁移：删除任何快照始终是安全的。
