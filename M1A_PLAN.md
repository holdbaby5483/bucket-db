# M1a 实施计划（0.4.0-beta.0）

依据：`ROADMAP.md` 第 3 节 D1、D3、D4、D6，第 4 节 M1a，第 6 节决策记录。
状态：**待你审阅，未开工。** 第 9 节列出需要你拍板的取舍。

证据标注沿用路线图：**实测** = 已运行；**设计估算** = 推算；**待验证** = 开工后先验证。

## 0. 起点（M0 之后）

- `@hold-baby/bucket-db@0.3.2` 的提交已在 `main` 上，尚未推送。源码 1,883 行（**实测**，含 `ali-oss.d.ts`），查询缓存已删除。
- 回归测试 `tests/core/collection-faults.test.ts` 只经由公开接口测试，M1a 必须**原样通过，一行不改**。为此有三处约束：
  - `S3Adapter` 继续接受 `{ bucket, region, credentials: { accessKeyId, secretAccessKey }, endpoint }`。
  - `StorageError` 继续接受 `new StorageError(message)`。
  - 包装后端的操作名继续叫 `'get'`、`'put'`。
- M0 实测发现，并入 M1a 的需求：
  - S3 上并发 `If-Match` 写，失败方是 412 和 409 混合：3 轮共 40 个 412、17 个 409，SDK 不重试 409。
  - OSS 上即使单进程并发写，也会丢索引条目。

## 1. 对外变化

| 项 | 0.3.2 | 0.4.0-beta.0 |
|---|---|---|
| 运行时依赖 | `@aws-sdk/client-s3`、`ali-oss` | 无 |
| `insert` | 6 个请求（WAL、文档、分片、元数据、清 WAL） | 1 个 PUT（`ifNoneMatch: '*'`） |
| `find` | 读 16 个元数据 + 非空分片 + 命中文档 | ⌈N/1000⌉ 个 LIST + N 个 GET（并发 16）；`{ id }` 等值查询为 1 个 GET |
| `update` 带 `etag` | 读、比较、写 | GET + 条件 PUT；冲突抛 `ConcurrentUpdateError`，不重试；OSS 抛 `UnsupportedError` |
| `update` 不带 `etag` | 读、写（`ifMatch` 当前值） | 能条件写的后端：读、合并、条件写，冲突最多重试 5 次；OSS：后写覆盖 |
| `delete` | 先读，不存在抛 `DocumentNotFoundError` | 1 个 DELETE，幂等 |
| `findById` | 任何错误都返回 `null` | 仅 NotFound 返回 `null`，其余抛出 |
| 非法集合名、ID | 静默改写（`a/b` 变成 `a_b`） | 抛 `ValidationError` |
| `shardCount`、`defaultShardCount` | 有 | 删除 |
| `S3Adapter` / `OSSAdapter` 构造 | 必须给凭证 | 凭证、region 可省略，从环境变量读取；支持 session token 和回调 |
| 存储布局 | `docs/` + `index/` + `wal/` | 只有 `docs/<id>.json`；旧的 `index/`、`wal/` 忽略（D6） |

以下推迟，不在 M1a 内：

| 项 | 推迟到 | 原因 |
|---|---|---|
| 快照 | M1b | — |
| `logger` 回调 | M1b | 删掉 WAL 后 `src` 里不再有 `console.*`，日志回调的第一个使用者是 M1b 的快照回写 |
| `put`、`insert(data, { id })`、`sort`、`count`、`deleteMany`、查询语义定稿 | M2 | — |

## 2. 后端接口（`StorageAdapter` v2）

```ts
// src/storage/adapter.ts
export type Guarantee = 'atomic' | 'single-process' | 'none';

export interface Capabilities {
  /** put(key, body, { ifNoneMatch: '*' }) */
  readonly createIfAbsent: Guarantee;
  /** put(key, body, { ifMatch }) */
  readonly compareAndSwap: Guarantee;
}

export type WriteCondition = { ifNoneMatch: '*' } | { ifMatch: string };

export interface ObjectEntry {
  key: string;
  etag: string; // 不带引号；与 get/put 返回的同一对象 ETag 相同
}

export interface ListPage {
  entries: ObjectEntry[]; // 按 key 字典序
  cursor?: string;        // 有下一页时存在
}

export interface StorageAdapter {
  readonly capabilities: Capabilities;
  /** 不存在：StorageError kind 'not-found' */
  get(key: string): Promise<{ body: Uint8Array; etag: string }>;
  /**
   * 条件不满足：kind 'conflict'。
   * ifMatch 而对象不存在：kind 'not-found'。
   * 对应能力为 'none'：抛 UnsupportedError，且不发出请求。
   */
  put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }>;
  /** 幂等，对象不存在不报错 */
  delete(key: string): Promise<void>;
  /** limit 缺省且最大 1000 */
  list(prefix: string, options?: { cursor?: string; limit?: number }): Promise<ListPage>;
}

/** 有并发上限的批量读取，结果按输入顺序逐项给出，失败项显式返回 */
export function getMany(
  adapter: StorageAdapter,
  keys: string[],
  concurrency = 16
): Promise<Array<
  | { key: string; body: Uint8Array; etag: string }
  | { key: string; error: StorageError }
>>;
```

与 v1 的差异和理由：

- **接口以字节为单位，不再是 JSON。** JSON 编解码移到 `Collection`。D4 要求条件写在网络重试后收到冲突时回读并比较内容，按字节比较才精确。快照（M1b）也直接复用这个接口。
- **删除 `exists`。** 调用方用 `get` 并判断 NotFound。
- **删除 `batchGet` 方法，改为基于 `get` 的公共函数 `getMany`。** 自定义后端少实现一个方法，并发上限和失败项语义也只需实现一次。
- **`list` 分页并返回 ETag。** 这是 D2 的前提，`limit` 也让一致性测试不必写 1,000 个对象就能测分页。

各后端声明的能力：

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| `createIfAbsent` | atomic | atomic（`link()`，跨进程） | atomic | atomic（`x-oss-forbid-overwrite`；版本化 bucket 无效，见第 10 节） |
| `compareAndSwap` | atomic | single-process | atomic | none |

## 3. 错误类层次

```ts
// src/errors.ts
export class BucketDBError extends Error {}

export class ValidationError extends BucketDBError {}        // 非法集合名、ID、dbPath、filter 结构；PathValidationError 并入
export class DocumentNotFoundError extends BucketDBError {}  // update 的文档不存在
export class ConcurrentUpdateError extends BucketDBError {}  // etag 过期；或不带 etag 的 update 重试耗尽
export class UnsupportedError extends BucketDBError {}       // 需要后端不具备的能力（OSS 上带 etag 的 update）

export type StorageErrorKind = 'not-found' | 'conflict' | 'transient' | 'permanent';

export class StorageError extends BucketDBError {
  readonly kind: StorageErrorKind;
  readonly key?: string;
  readonly status?: number; // HTTP 状态码，非 HTTP 后端为空
  constructor(
    message: string,
    options?: { kind?: StorageErrorKind; key?: string; status?: number; cause?: unknown }
  ); // kind 缺省为 'permanent'
}
```

`Collection` 对后端错误的处理：

| 后端错误 | `findById` | `find` | `update` | `insert` / `delete` |
|---|---|---|---|---|
| not-found | 返回 `null` | 结果中去掉该文档（LIST 之后被删除） | `DocumentNotFoundError` | `delete` 视为成功 |
| conflict | — | — | 带 etag：`ConcurrentUpdateError`；不带 etag：重试 | 原样抛出（UUID 冲突，实际不会发生） |
| transient | 抛出（重试已在客户端内耗尽） | 抛出 | 抛出 | 抛出 |
| permanent | 抛出 | 抛出；`docs/` 下不是 JSON 对象的文件也抛这一类，并带上 `key` | 抛出 | 抛出 |

## 4. 内置客户端（D3）

公开部分只有两个构造参数类型：

```ts
export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt?: Date; // 回调返回值带此字段时，到期前 5 分钟重新调用回调
}
export type CredentialProvider = () => Promise<Credentials>;

export interface S3AdapterOptions {
  bucket: string;
  region?: string;          // 缺省依次读 AWS_REGION、AWS_DEFAULT_REGION
  endpoint?: string;        // 缺省依次读 AWS_ENDPOINT_URL_S3、AWS_ENDPOINT_URL，否则用 https://s3.<region>.amazonaws.com
  credentials?: Credentials | CredentialProvider; // 缺省读 AWS_ACCESS_KEY_ID、AWS_SECRET_ACCESS_KEY、AWS_SESSION_TOKEN
  forcePathStyle?: boolean; // 缺省：endpoint 是 IP 或 localhost 时为 true，否则用 virtual-hosted
  timeoutMs?: number;       // 单次尝试的超时，缺省 10000
}

export interface OSSAdapterOptions {
  bucket: string;
  region?: string;          // 缺省读 OSS_REGION；写成 cn-hangzhou，也兼容 0.3 的 oss-cn-hangzhou 写法
  endpoint?: string;        // 缺省读 OSS_ENDPOINT，否则用 https://s3.oss-<region>.aliyuncs.com（官方 S3 兼容端点）
  credentials?: Credentials | CredentialProvider; // 缺省读 OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET、OSS_SESSION_TOKEN
  timeoutMs?: number;
}
```

环境变量名与 AWS CLI、ossutil 2.0 一致（已查官方文档）。`.env` 里现有的 `OSS_*` 变量名可以直接用。

内部结构不导出：

```ts
// src/storage/s3/client.ts
interface Dialect {
  createIfAbsent: [header: string, value: string]; // aws: ['if-none-match', '*']; oss: ['x-oss-forbid-overwrite', 'true']
  supportsIfMatch: boolean;                        // aws: true; oss: false
  isConflict(status: number, code: string): boolean;
  // aws: 412 PreconditionFailed、409 ConditionalRequestConflict
  // oss: 409 FileAlreadyExists、412
}

class S3Client implements StorageAdapter {
  constructor(options: ResolvedOptions, dialect: Dialect);
}
```

行为：

- **签名。** SigV4，用 Web Crypto（`crypto.subtle`），Bun 和 Node 20 以上原生可用。`x-amz-content-sha256` 取正文的 SHA-256，不用 `UNSIGNED-PAYLOAD`，以兼容 OSS。有 session token 时带 `x-amz-security-token`。
- **超时。** 每次尝试使用 `AbortSignal.timeout(timeoutMs)`。
- **重试。** 最多 3 次尝试，full-jitter 指数退避（基数 100 ms，上限 2 s）。
  - 重试：网络错误、超时、500、502、503、504、429，以及错误码 `SlowDown`、`RequestTimeout`。
  - 其余 4xx 不重试，归为 permanent。
  - 重试耗尽后归为 transient。
- **条件写误报。** 某次尝试遇到 transient 之后，后续尝试收到冲突时，GET 回读并逐字节比较。相同则认定是自己先前那次尝试写成功了，返回 GET 得到的 ETag。
- **LIST。** 使用 ListObjectsV2，带 `encoding-type=url`，按 `continuation-token` 分页。XML 只解析 `Key`、`ETag`、`IsTruncated`、`NextContinuationToken`。错误响应只解析 `Code`、`Message`。
- **OSS 上 `ifMatch`。** 声明 `compareAndSwap: 'none'`，`put` 收到 `ifMatch` 时直接抛 `UnsupportedError`。实测 OSS 返回 400 `NotImplemented`，这里不发出请求。

## 5. Collection 与 FileSystem 后端

Key 与名字：

- key 一律用 `/` 拼接，不经过 `node:path`：`<dbPath>/<collection>/docs/<id>.json`。
- 集合名和 ID 必须匹配 `^[A-Za-z0-9_.-]{1,255}$` 且不以 `.` 开头，不合规直接抛 `ValidationError`，不改写。
- `dbPath` 按 `/` 分段，每段遵守同一规则；空字符串表示 bucket 根目录。

文档体：

- 写入时不包含 `_etag`。
- 读取时，`id` 被 key 覆盖，`_etag` 被真实 ETag 覆盖。
- `UpdateDocument<T>` 类型去掉 `id`、`_etag`、`_createdAt`、`_updatedAt`；运行时 `update` 也会剥离这些字段。

`find`：

- 流程：LIST 全部分页 → `getMany`，并发 16 → 去掉 not-found → 解析 JSON，不是 JSON 对象就抛错并指出 key → 过滤 → `offset` / `limit`。
- 顺序按 key，即按 ID。M2 再加 `sort`。
- 过滤器结构错误（保留字段、未知操作符、`$in` 的操作数不是数组）抛 `ValidationError`。类型不符时的语义留到 M2 处理（4.12）。

FileSystem 后端：

- 改用 `fs/promises`。
- ETag 为 `inode-mtimeNs-size`。每次写入都先写临时文件再 rename 或 link，所以每次写入后 ETag 都会变。
- `get` 在同一个文件描述符上先 `fstat` 再读取，保证 ETag 与内容一致。
- 临时文件名为 `<path>.<uuid>.tmp`。
- 创建：先写临时文件，再 `link()`。目标已存在时返回 EEXIST，归为 conflict，跨进程有效。
- CAS：进程内按 key 加锁，然后比较 ETag 并 rename，只在单进程内成立。
- `.meta` 文件不再写入。0.3 留下的 `.meta` 和 `.tmp` 文件在 LIST 时跳过。

Memory 后端：`Map<key, { body, etag }>`，ETag 由计数器生成。

## 6. 文件拆分

```text
packages/core/src/
  index.ts              公开导出
  bucket-db.ts          BucketDB
  collection.ts         Collection
  keys.ts               名字、ID、dbPath 校验与 key 拼接
  errors.ts             第 3 节的错误类
  types.ts              Document、InsertDocument、UpdateDocument、QueryFilter、QueryOptions、UpdateOptions
  query.ts              evaluateFilter、validateFilter（由 query/evaluator.ts 移来，语义不变）
  storage/
    adapter.ts          第 2 节的接口与 getMany
    memory.ts
    fs.ts
    s3/
      sigv4.ts
      credentials.ts    环境变量解析与回调缓存
      client.ts         请求、超时、重试、错误分类、LIST 解析、两种方言
      adapters.ts       S3Adapter、OSSAdapter
```

删除：`core/wal.ts`、`index/shard-manager.ts`、`utils/hash.ts`、`utils/path-validator.ts`、旧的 4 个 adapter、`storage/ali-oss.d.ts`、`types/*`。

行数预算（**设计估算**），总计约 1,320 行，相对路线图 2,070 行的上限，留约 750 行给 M1b 的快照和 M2 的 CLI：

| 文件 | 行数 | 文件 | 行数 |
|---|---:|---|---:|
| collection.ts | 210 | s3/client.ts | 260 |
| query.ts | 140 | s3/sigv4.ts | 90 |
| fs.ts | 150 | s3/credentials.ts | 50 |
| memory.ts | 60 | s3/adapters.ts | 60 |
| adapter.ts | 60 | errors.ts | 60 |
| keys.ts | 50 | types.ts | 50 |
| bucket-db.ts | 40 | index.ts | 40 |

## 7. 一致性测试用例清单

`tests/conformance/adapter-suite.ts` 导出 `defineAdapterSuite(name, factory)`。每个后端一个入口文件调用它，用例按后端声明的能力自动选取或跳过。Collection 层的用例同样用这套 factory 跑遍所有后端。

运行目标：

| 目标 | 何时运行 |
|---|---|
| Memory、FileSystem | 每次 CI |
| fake S3（M0 的 `tests/support/fake-s3.ts` 扩展：分页、OSS 方言、丢响应、延迟） | 每次 CI，aws 和 oss 两种方言各跑一遍 |
| 本地 S3 替身 | 每次 CI，选型见第 8 节第 6 步 |
| 真实 OSS | 带 secrets 的 CI job |
| 真实 S3 | 本地有 `.env` 时 |

所有写入都在 `test/<suite>-<时间戳>/` 下，结束时清理并断言没有残留。

**A. 后端契约**

| # | 用例 |
|---|---|
| A1 | `get` 不存在的 key 抛 kind `not-found` |
| A2 | `put` 后 `get` 得到相同字节，ETag 与 `put` 返回的一致 |
| A3 | 无条件 `put` 覆盖已有对象；内容变化时 ETag 变化 |
| A4 | `delete` 后 `get` 抛 not-found；`delete` 不存在的 key 不报错 |
| A5 | `list` 只返回该前缀下的对象（`docs/` 不包含 `docs2/`），按字典序，ETag 与 `get` 一致 |
| A6 | 25 个对象、`limit: 10` 分 3 页，无重复、无遗漏 |
| A7 | LIST 写后即一致：写、覆盖、删除之后立即 LIST，结果与操作一致。CI 跑 5 轮，路线图附录 B 跑过 30 轮 |
| A8 | 合法字符的 key（`a-b_c.d`）与多级前缀往返无损 |

**B. 条件写（按声明的能力执行）**

| # | 用例 |
|---|---|
| B1 | `ifNoneMatch: '*'`：key 不存在时成功；已存在时抛 conflict，原对象不变 |
| B2 | 10 个并发 `ifNoneMatch` 写同一 key：恰好 1 个成功，存储内容是成功者写入的 |
| B3 | `ifMatch`：ETag 正确时成功；ETag 过期时抛 conflict，对象不变；key 不存在时抛 not-found |
| B4 | 10 个并发 `ifMatch` 写同一 key：恰好 1 个成功，最终内容是成功者写入的。用 S3 的 409 与 412 混合情况验证 |
| B5 | 能力为 `none` 时抛 `UnsupportedError`，且服务端没有收到请求（fake S3 计数） |
| B6 | 声明 `atomic` 的能力必须通过 B2 / B4，保证能力声明不说谎 |

**C. 故障注入（fake S3）**

| # | 用例 |
|---|---|
| C1 | 503、500、429 之后成功：操作成功，尝试次数不超过 3 |
| C2 | 连续失败直到重试耗尽：抛 kind `transient`，带 `status` |
| C3 | 服务端延迟超过 `timeoutMs`：这次尝试被中止并重试；耗尽后抛 transient |
| C4 | 连接被重置：重试 |
| C5 | 403：不重试，抛 permanent |
| C6 | 条件写第一次实际写成功但响应丢失：重试收到冲突，回读字节相同，报告成功而不是冲突。`ifNoneMatch` 和 `ifMatch` 各测一遍 |
| C7 | 同 C6，但两次尝试之间有另一个写入者写入：报告真实冲突 |
| C8 | 凭证：读取环境变量；回调在 `expiresAt` 前 5 分钟重新调用；session token 出现在请求头里 |
| C9 | SigV4：AWS 公开的签名示例向量（单元测试） |

**D. Collection（跑遍所有后端）**

| # | 用例 |
|---|---|
| D1 | M0 的 4 个回归测试原样通过 |
| D2 | `insert`、`delete` 各恰好 1 次存储调用，`findById` 恰好 1 次 GET（包装后端计数） |
| D3 | CRUD 往返；`findById` 不存在返回 `null`；读取失败时抛错 |
| D4 | `find` 返回的每条文档都满足过滤条件：随机生成文档和过滤器，与内存中的参照实现对比 |
| D5 | LIST 之后、GET 之前被删除的文档不出现在结果里 |
| D6 | `docs/` 下不是 JSON 对象的文件：`find` 和 `findById` 抛错，错误里有该 key |
| D7 | 手工放进 `docs/` 的 JSON 文件就是一条文档：`id` 取自 key，`_etag` 是真实 ETag |
| D8 | 文档体里的 `_etag` 和 `id` 在读取时被覆盖；写入后的文档体不含 `_etag` |
| D9 | `update` 带过期 `etag` 抛 `ConcurrentUpdateError` 且不重试；OSS 上抛 `UnsupportedError` |
| D10 | 不带 `etag` 的并发 `update` 修改不同字段：能条件写的后端上全部字段都保留；OSS 上不报错，后写覆盖 |
| D11 | `update` 不存在的文档抛 `DocumentNotFoundError`；不能修改 `id` 和 `_createdAt` |
| D12 | 非法名字和 ID（`a/b`、`.x`、`''`、256 个字符）抛 `ValidationError`，且没有任何存储调用 |
| D13 | 0.3.1 写出的集合（fixture：`docs/` + `index/` + `wal/` + `.meta`）能被 `find` 读出全部文档 |
| D14 | 崩溃注入：每个操作的第 N 次存储调用之后停止一切调用；重新打开集合后，状态要么是旧的要么是新的 |
| D15 | 多进程：4 个 `bun` 子进程各插入 25 条到同一集合，父进程能 `find` 到全部 100 条。在 FileSystem、fake S3、本地 S3 替身、真实 OSS 上运行 |

验收与用例的对应：

| M1a 验收项 | 用例 |
|---|---|
| 每个操作在每一步注入崩溃后，状态要么旧要么新 | D14 |
| 多进程并发插入全部可见（本地 S3 替身、真实 OSS） | D15 |
| 查询返回的每条文档都满足过滤条件 | D4 |
| 条件写重试后不误报冲突 | C6、C7 |
| “小巧”指标 | 第 8 节第 6 步的 CI 门禁 |

## 8. 实施顺序与提交

在分支 `m1a` 上进行，每个提交都能编译、测试全绿：

1. **`feat(core): add zero-dependency S3 protocol client`**
   - 内容：`sigv4.ts`、`credentials.ts`、`client.ts`，暂不导出。附带 C1–C9 和扩展后的 fake S3。
   - 第一件事：对真实 OSS 和真实 S3 确认 endpoint 与签名 region 的组合。附录 B 的原型脚本已删除，组合需要重新确认（**待验证**）。
2. **`feat(core): add storage contract v2 and adapters`**
   - 内容：`adapter.ts`、`errors.ts`，以及新的 memory、fs、S3、OSS 后端，和旧后端并存，`Collection` 暂不改动。附带 A、B 两组用例，覆盖全部运行目标。
3. **`feat(core)!: rewrite Collection on storage contract v2`**
   - 内容：`collection.ts`、`bucket-db.ts`、`keys.ts`、`types.ts`、`query.ts`。删除第 6 节列出的全部旧文件，`package.json` 去掉两个 SDK。
   - 测试：D1–D13；旧的 `collection.test.ts` 和 `shard-manager.test.ts` 改写或删除。
4. **`test(core): crash injection and multi-process tests`**：D14、D15。
5. **`feat(mcp)!: follow core 0.4 API`**：构造参数与凭证改用环境变量，适配 `delete` 的幂等语义，`tsc` 通过。
6. **`ci: node matrix, size gates, local S3 double`**
   - Node 矩阵：Bun 版本固定；Node 20 和 22 各跑一遍构建产物的冒烟脚本（Memory、FS、fake S3 的 CRUD），因为 `bun:test` 不能在 Node 上运行。
   - `engines: { node: ">=20" }`。
   - 门禁：运行时依赖为 0；`npm pack` 体积不超过 50 kB；从 tarball 安装后小于 200 kB；`src` 不超过 2,070 行。
   - 本地 S3 替身：依次试 Garage、SeaweedFS、Floci，取第一个通过 A7、B1–B4 的。都不满足时，这些用例只在真实 S3 上运行。
   - 真实 OSS job 改为运行一致性套件。
7. **`docs: 0.4.0-beta.0`**：README、文档站、`llms.txt`、CHANGELOG、迁移说明初稿（正式版在 M1b）。版本号改为 `0.4.0-beta.0`。

推送、打 tag、发布都等你的指令。

## 9. 需要你确认

| # | 问题 | 我的建议 | 另一个选项 |
|---|---|---|---|
| 1 | 存储错误的形式 | 一个 `StorageError` 类，用 `kind` 字段区分 | 每类一个子类，可以用 `instanceof`，但多 3 个导出 |
| 2 | 后端接口的数据单位 | 字节（`Uint8Array`） | 保持 JSON：自定义后端更好写，但重试误报只能比较解析后的值 |
| 3 | `logger` 回调 | 推迟到 M1b，和它的第一个使用者一起上线 | 按路线图在 M1a 加入，但 M1a 里没有调用者 |
| 4 | `UpdateDocument` 去掉系统字段 | 去掉，类型层面也禁止修改 `_createdAt` | 只在运行时剥离，类型不变 |
| 5 | 客户端可调参数 | 只开放 `timeoutMs`，最大尝试次数固定为 3 | 也开放 `maxAttempts`，但违背第 5 节“不加调优旋钮” |
| 6 | 不带 etag 的 `update` 重试上限 | 5 次，然后抛 `ConcurrentUpdateError` | 3 次，与网络重试一致 |
| 7 | 空的 `dbPath` | 允许，表示 bucket 根目录，方便 M2 支持 `s3://bucket` 这种不带前缀的连接串 | 禁止 |
| 8 | Node 上验证什么 | 跑构建产物的冒烟脚本 | 引入 Node 能运行的测试框架，但会多一个开发依赖并有两套写法 |

## 10. 风险与待验证

| 项 | 处理 |
|---|---|
| OSS S3 兼容端点的确切 endpoint 与签名 region | 第 1 步先用真实 bucket 确认。官方文档给出的是 `https://s3.oss-{region}.aliyuncs.com`、region 写 `cn-hangzhou`、virtual-hosted；附录 B 实测可用，但当时的配置没有留下 |
| 中国大陆区域的新 OSS 用户必须使用自定义域名 | 用 `endpoint` 选项支持；S3 兼容协议经自定义域名是否可用仍**待验证**（路线图第 8 节） |
| 版本化的 OSS bucket 上 `x-oss-forbid-overwrite` 无效 | 能力声明无法感知 bucket 配置；写进文档，M2 的 `doctor` 负责检测 |
| 代理环境下 `fetch` 是否读取代理变量 | 第 1 步在 Bun 和 Node 上各确认一次，写进文档 |
| FileSystem 的 ETag 依赖 inode 和 mtime 的精度 | 每次写都换新 inode，不依赖 mtime 精度；A3、B3 会覆盖 |
| 行数预算超支 | 第 6 步的门禁直接阻断 |
