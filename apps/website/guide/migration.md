# 升级指南

## 从 0.4 升级到 0.5

0.5.0 新增了连接字符串（`BucketDB.connect()` / `BUCKET_DB_URL`）、`put`、带 `id` 的 `insert`、`sort`、`count`、`deleteMany` 和命令行工具（见[命令行](/guide/cli)）。**存储格式没有变化**，不需要转换数据。以下 4 项是不兼容变更，完整说明见 [MIGRATION-0.5.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.5.md)。

### 查询语义

字段缺失按 `undefined` 处理；类型不同不再报错（完整规则见[匹配规则](/guide/queries#匹配规则)）。

```typescript
// 0.4：文档中 age 为 "30"（字符串）时抛出 ValidationError
// 0.5：该文档只是不匹配
await users.find({ age: { $gt: 18 } });

// 0.4：不匹配缺少 role 字段的文档
// 0.5：$ne / $nin 也匹配缺少该字段的文档
await users.find({ role: { $ne: 'admin' } });

// 需要要求字段存在时，在代码中过滤
const withRole = (await users.find({ role: { $ne: 'admin' } }))
  .filter(u => u.role !== undefined);
```

`$nin: []` 现在不排除任何文档，也不再跳过同一字段上的其他操作符（0.4 的缺陷）。

### 默认顺序

```typescript
// 0.4：按 key（文档 ID）顺序，自动生成的 ID 是随机 UUID
// 0.5：按 _createdAt 升序、再按 id 升序（大致是插入顺序）
const all = await users.find({});

// 需要其他顺序时显式传入 sort
const byName = await users.find({}, { sort: { name: 1 } });
```

### `limit: 0`

```typescript
// 0.4：limit: 0 被忽略，返回全部
// 0.5：返回 []
await users.find({}, { limit: 0 });

// 需要全部时省略 limit
await users.find({});
```

负数或小数的 `limit` / `offset` 现在抛出 `ValidationError`。

### MCP 服务器配置

MCP 服务器（0.2.0）只通过 `BUCKET_DB_URL` 配置，凭证来自 `AWS_*` / `OSS_*` 环境变量：

```bash
# 旧配置
BUCKET_DB_ADAPTER=s3 BUCKET_DB_S3_BUCKET=my-bucket BUCKET_DB_S3_REGION=us-east-1 BUCKET_DB_PATH=app

# 新配置（凭证放在 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）
BUCKET_DB_URL=s3://my-bucket/app?region=us-east-1
```

完整对照见 [MCP 服务器](/guide/mcp#从-0-1-配置迁移)。

## 从 0.3 升级到 0.4

0.4.0 重写了存储核心：每个文档一个对象，不再有索引和日志文件，零运行时依赖，内置 S3 客户端。文档数据格式没有变化，0.4 可以直接读取 0.3 的集合；但部分 API 有破坏性变更，自定义存储适配器需要重写。

### 变更一览

| 项目 | 0.3.x | 0.4.0 |
|------|-------|--------------|
| 存储布局 | 文档 + 索引分片 + 日志 | `docs/<id>.json`；S3/OSS 另有 `_snapshot.v1.json` |
| `find` | 下载索引 | S3/OSS：LIST + 快照 + 变化的文档；Memory/FileSystem：读取每个文档；`{ id }` 只读一个 |
| 运行时依赖 | AWS SDK、ali-oss | 无 |
| 分片配置 | `defaultShardCount` / `shardCount` | 移除 |
| `delete` 不存在的文档 | 抛 `DocumentNotFoundError` | 不报错（幂等） |
| 不合法的名字 | 被改写（`a/b` → `a_b`）或抛 `PathValidationError` | 抛 `ValidationError`，不改写 |
| `findById` 存储读取失败 | 返回 `null` | 抛 `StorageError`（仅文档不存在时返回 `null`） |
| `StorageError` | `new StorageError(message, cause)` | `new StorageError(message, { kind, key, status, cause })`，新增 `kind` / `key` / `status` |
| 适配器构造参数 | `region`、`credentials` 必填 | 可选，回退到环境变量 |
| OSS `region` / `endpoint` | `oss-cn-hangzhou` / OSS 原生 endpoint | `cn-hangzhou` / OSS 的 S3 兼容 endpoint |
| OSS 带 `etag` 的 `update` | 非原子模拟 | 抛 `UnsupportedError` |
| `UpdateDocument<T>` | 可包含 `_etag`、`_createdAt`、`_updatedAt` | 排除所有系统字段 |
| `StorageAdapter` 接口 | `get/put/delete/exists/listKeys/batchGet` | `capabilities` + `get/put/delete/list`（字节、分页） |
| 运行环境 | 未声明 | Node.js 20+ 或 Bun |

### 破坏性变更

#### 移除分片配置

`BucketDB` 构造函数不再有第三个参数，`db.collection()` 不再有第二个参数。

```typescript
// 0.3
const db = new BucketDB(adapter, 'my-app', { defaultShardCount: 32 });
const users = db.collection<User>('users', { shardCount: 32 });

// 0.4
const db = new BucketDB(adapter, 'my-app');
const users = db.collection<User>('users');
```

#### `delete` 变为幂等

```typescript
// 0.3
try {
  await users.delete(id);
} catch (error) {
  if (!(error instanceof DocumentNotFoundError)) throw error;
}

// 0.4：文档不存在也不报错
await users.delete(id);
```

`update` 不存在的文档仍然抛出 `DocumentNotFoundError`。

#### 不合法的名字抛出 `ValidationError`

集合名、文档 ID 和 `dbPath` 的每一段都必须匹配 `^[A-Za-z0-9_.-]{1,255}$` 且不能以 `.` 开头。0.4 不再改写名字；`PathValidationError` 已移除。

```typescript
// 0.3：'reports/2024' 被改写为 'reports_2024'
const reports = db.collection('reports/2024');

// 0.4：直接使用合法的名字，否则抛 ValidationError
const reports = db.collection('reports_2024');
```

如果 0.3 中用过会被改写的名字，0.4 中请使用改写后的实际名字（即存储中的目录名）。

`dbPath` 也不再经过 `path.join` 规整：0.3 中 `'./app/'` 被存为 `app`，0.4 会拒绝它，请直接写 `'app'`。多级前缀（如 `'tenants/a'`）仍然可以使用。

```typescript
import { ValidationError } from '@hold-baby/bucket-db';

try {
  db.collection(userInput);
} catch (error) {
  if (error instanceof ValidationError) {
    // 名字不合法
  }
}
```

#### `findById` 在存储错误时抛出

```typescript
// 0.3：网络或权限错误时也返回 null
const user = await users.findById(id);
if (!user) { /* 不存在，或读取失败 */ }

// 0.4：只有文档不存在才返回 null，其他错误抛出 StorageError
try {
  const user = await users.findById(id);
  if (!user) { /* 确实不存在 */ }
} catch (error) {
  if (error instanceof StorageError) {
    console.error(error.kind, error.key, error.status);
  }
}
```

#### `StorageError` 新增 `kind` / `key` / `status`

第二个构造参数改为选项对象。`kind` 取值为 `'not-found' | 'conflict' | 'transient' | 'permanent'`（默认 `'permanent'`）；`transient` 表示重试后仍失败的可重试错误。

```typescript
// 0.3
throw new StorageError('Failed to read', cause);

// 0.4
throw new StorageError('Failed to read', { kind: 'transient', key, status: 503, cause });
```

#### 适配器构造参数

`region` 和 `credentials` 变为可选，未传入时从环境变量读取（见[安装指南](/guide/installation)）。`credentials` 支持 `sessionToken`，也可以是返回凭证的异步函数。

```typescript
// 0.3
const s3 = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: { accessKeyId: '...', secretAccessKey: '...' }
});

// 0.4：可以完全依赖 AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
const s3 = new S3Adapter({ bucket: 'my-bucket' });
```

OSS 的 `region` 写法改为 `cn-hangzhou`（0.3 的 `oss-cn-hangzhou` 仍被接受）；`endpoint` 现在指 OSS 的 **S3 兼容** endpoint，默认 `https://s3.oss-<region>.aliyuncs.com`，不再读取 `OSS_ENDPOINT`。

```typescript
// 0.3
const oss = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'oss-cn-hangzhou',
  credentials: { accessKeyId: '...', secretAccessKey: '...' },
  endpoint: 'https://oss-cn-hangzhou.aliyuncs.com'
});

// 0.4：凭证可回退到 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_SESSION_TOKEN
const oss = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'cn-hangzhou'
});
```

如果 0.3 中把 `endpoint` 设为 OSS 原生 endpoint，0.4 中请删除它（使用默认值），或改为 S3 兼容 endpoint。通过自定义域名进行 S3 兼容访问目前未经验证。

#### OSS 上带 `etag` 的 `update` 抛出 `UnsupportedError`

```typescript
// 0.3：在 OSS 上可以调用，但无法阻止并发覆盖
await users.update(id, { age: 26 }, { etag: user._etag });

// 0.4：在 OSS 上抛 UnsupportedError（不发送请求），请去掉 etag
await users.update(id, { age: 26 });
```

在 OSS 上不带 `etag` 的并发更新是后写覆盖。需要乐观锁请使用 S3。

#### `UpdateDocument<T>` 排除系统字段

```typescript
// 0.3：类型允许传入 _etag / _createdAt / _updatedAt
await users.update(id, { age: 26, _updatedAt: new Date().toISOString() });

// 0.4：系统字段不能出现在更新数据中，_updatedAt 自动设置
await users.update(id, { age: 26 });
```

#### 类型导出变化

- **移除**：`StorageObject`、`PutOptions`、`StorageCredentials`、`StorageAdapterConfig`、`ICollection`、`CollectionMeta`、`IndexShard`
- **新增**：`UnsupportedError`、`FileSystemAdapterConfig`、`S3AdapterOptions`、`OSSAdapterOptions`、`Credentials`、`CredentialProvider`、`Capabilities`、`Guarantee`、`WriteCondition`、`ObjectEntry`、`ListPage`、`ListOptions`、`StorageErrorKind`、`StorageErrorOptions`

```typescript
// 0.3
import type { StorageCredentials, StorageAdapterConfig } from '@hold-baby/bucket-db';

// 0.4
import type { Credentials, S3AdapterOptions, OSSAdapterOptions } from '@hold-baby/bucket-db';
```

### 迁移已有的 0.3 集合

文档对象 `docs/<id>.json` 的格式没有变化，**不需要转换数据**，0.4 可以直接读取 0.3 的集合。

1. **停止所有 0.3 写入进程**。0.3 只读取自己的索引，看不到 0.4 的写入；0.3 和 0.4 不能同时写入同一集合。
2. 升级依赖到 `@hold-baby/bucket-db@0.4.0`（或直接升级到 0.5.0，并同时按上文“从 0.4 升级到 0.5”修改），按上文修改代码。
3. 启动 0.4 客户端。
4. （可选）删除 0.3 遗留的 `index/`、`wal/` 目录和 `docs/*.meta` 文件。0.4 会忽略它们，删除只是为了节省存储空间。

0.4 直接列出 `docs/`，不再读取 0.3 的索引。0.3 索引里没有登记的文档文件（例如 0.3 中写完文档后失败的 `insert`）现在会出现在 `find` 结果中；`find` 返回的是文档文件本身的内容，而 0.3 的索引副本可能已经过时。如果这一点对你重要，升级后执行一次 `find({})` 检查。

在 S3/OSS 上，0.4 的查询会在集合里创建 `_snapshot.v1.json`（某次查询需要逐个读取的文档超过 16 个时写入；位于 `docs/` 旁边，与 0.3 遗留的 `index/`、`wal/` 并列，后两者仍被忽略）。快照只用于加速查询，可随时删除，见[存储格式](./storage-format)。快照包含文档内容的副本，访问权限应与 `docs/` 相同。只读凭证同样可用：第一次遇到 401/403 后该集合就不再尝试写快照，查询照常返回正确结果。

### 重写自定义存储适配器

0.4 的 `StorageAdapter` 是一个扁平的键值对象存储接口，读写字节（`Uint8Array`），并通过 `capabilities` 声明条件写入的保证强度。

```typescript
// 0.3
interface StorageAdapter {
  get(key: string): Promise<StorageObject>;
  put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  listKeys(prefix: string): Promise<string[]>;
  batchGet(keys: string[]): Promise<Map<string, StorageObject>>;
}

// 0.4
interface StorageAdapter {
  readonly capabilities: Capabilities;
  readonly remote?: boolean;
  get(key: string): Promise<{ body: Uint8Array; etag: string }>;
  put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  list(prefix: string, options?: ListOptions): Promise<ListPage>;
}
```

约定：

- `capabilities.createIfAbsent` / `capabilities.compareAndSwap` 取值 `'atomic'`（存储服务保证，跨进程）、`'single-process'`（只在单进程内保证）或 `'none'`（不支持）。
- `get` 不存在的 key：抛 `StorageError`，`kind: 'not-found'`。
- `put` 条件不满足：抛 `StorageError`，`kind: 'conflict'`；`ifMatch` 对应的 key 不存在：`kind: 'not-found'`。
- `put` 请求了一个能力为 `'none'` 的条件：抛 `UnsupportedError`，且不发送请求。
- `delete` 不存在的 key：不报错。
- `list` 按 key 的字典序返回 `{ key, etag }`，每页最多 1000 条（`limit` 默认且最大 1000）；还有下一页时返回 `cursor`。`list` 返回的 etag 必须与 `get` / `put` 对同一版本返回的 etag 相同（不带引号）。
- `remote: true`（可选）：声明这是远程后端，集合会为它维护查询快照 `_snapshot.v1.json`（与 S3/OSS 相同）；不声明时每次 `find` 读取每个文档。

示例（基于 `Map` 的实现，与内置 `MemoryStorageAdapter` 相同）：

```typescript
import { StorageError, UnsupportedError } from '@hold-baby/bucket-db';
import type {
  StorageAdapter,
  Capabilities,
  WriteCondition,
  ListOptions,
  ListPage
} from '@hold-baby/bucket-db';

class MapAdapter implements StorageAdapter {
  readonly capabilities: Capabilities = { createIfAbsent: 'atomic', compareAndSwap: 'atomic' };
  private readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
  private version = 0;

  async get(key: string): Promise<{ body: Uint8Array; etag: string }> {
    const object = this.objects.get(key);
    if (!object) {
      throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
    }
    return { body: object.body.slice(), etag: object.etag };
  }

  async put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }> {
    if (condition && 'ifMatch' in condition && this.capabilities.compareAndSwap === 'none') {
      throw new UnsupportedError('Conditional update is not supported');
    }
    const existing = this.objects.get(key);
    if (condition && 'ifNoneMatch' in condition && existing) {
      throw new StorageError(`Object already exists: ${key}`, { kind: 'conflict', key });
    }
    if (condition && 'ifMatch' in condition) {
      if (!existing) {
        throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
      }
      if (existing.etag !== condition.ifMatch) {
        throw new StorageError(`ETag mismatch: ${key}`, { kind: 'conflict', key });
      }
    }
    const etag = `v${++this.version}`;
    this.objects.set(key, { body: body.slice(), etag });
    return { etag };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string, options: ListOptions = {}): Promise<ListPage> {
    const limit = Math.min(options.limit ?? 1000, 1000);
    const keys = [...this.objects.keys()]
      .filter(key => key.startsWith(prefix) && (options.cursor === undefined || key > options.cursor))
      .sort();
    const page = keys.slice(0, limit);
    return {
      entries: page.map(key => ({ key, etag: this.objects.get(key)!.etag })),
      cursor: keys.length > limit ? page[page.length - 1] : undefined
    };
  }
}
```

0.3 中的 `exists`、`listKeys`、`batchGet` 不再需要：BucketDB 用 `list` 列出文档，自己并发调用 `get` 读取。

## 下一步

- [核心概念](/guide/concepts) - 存储布局、操作成本与各后端的保证
- [安装指南](/guide/installation) - S3 / OSS 环境变量配置
- [错误处理](/guide/error-handling) - 错误类型说明
