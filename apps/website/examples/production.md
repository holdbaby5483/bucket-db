# S3 / OSS 云存储示例

使用 `S3Adapter` 和 `OSSAdapter` 把数据存到对象存储。

BucketDB 内置 S3 客户端（SigV4 签名基于 Web Crypto），没有任何运行时依赖，需要 Node >= 22 或 Bun。`S3Adapter` 通过 `endpoint` 可以连接任何兼容 S3 的服务（MinIO、R2 等），但目前只在 AWS S3 和阿里云 OSS 上测试过。需要经过 HTTP 代理访问存储时，Node 默认忽略 `HTTPS_PROXY`，需设置 `NODE_USE_ENV_PROXY=1`，见[命令行 · 代理](/guide/cli#代理)。

::: warning 使用前请阅读
OSS 不支持条件更新：带 `etag` 的 `update` 会抛出 `UnsupportedError`，不带 `etag` 的并发 `update` 后写覆盖；需要乐观锁请使用 S3。各后端的保证、容量范围和其他限制见[保证与限制](/guide/guarantees)。
:::

## AWS S3

### 配置 S3Adapter

```typescript
import { BucketDB, S3Adapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  email: string;
}

// 显式传入凭证
const adapter = new S3Adapter({
  bucket: 'my-app-bucket',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MY_S3_KEY_ID!,
    secretAccessKey: process.env.MY_S3_SECRET!,
  },
});

const db = new BucketDB(adapter, 'my-app');
const users = db.collection<User>('users');

await users.insert({ name: 'Alice', email: 'alice@example.com' });
const allUsers = await users.find({});
```

### 使用环境变量

`region`、`endpoint`、`credentials` 都是可选的，省略时从环境变量读取：

```bash
AWS_REGION=us-east-1             # 或 AWS_DEFAULT_REGION
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_SESSION_TOKEN=...            # 可选，临时凭证
# AWS_ENDPOINT_URL_S3 / AWS_ENDPOINT_URL  可选，默认 https://s3.<region>.amazonaws.com
```

```typescript
const adapter = new S3Adapter({ bucket: 'my-app-bucket' });
```

找不到 region 时构造函数抛出 `ValidationError`；找不到凭证时在第一次请求时抛出 `ValidationError`。

### 用 URL 连接

也可以用 `BucketDB.connect(url?, options?)` 一行连接，凭证同样来自环境变量；省略 `url` 时读取 `BUCKET_DB_URL`：

```typescript
// region / endpoint 等写在查询参数里，路径部分（my-app）成为 dbPath
const db = BucketDB.connect('s3://my-app-bucket/my-app?region=us-east-1');

// 或：BUCKET_DB_URL='s3://my-app-bucket/my-app?region=us-east-1'
const db2 = BucketDB.connect();
```

允许的参数为 `region`、`endpoint`（需 URL 编码，如 `endpoint=http%3A%2F%2Flocalhost%3A9000`）、`forcePathStyle`、`timeoutMs`。URL 中不能包含凭证（如 `s3://KEY:SECRET@bucket`），否则抛出 `ValidationError`，错误信息不会回显 URL，因此 URL 可以安全地写进日志。

### 临时凭证与凭证提供函数

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';
import type { Credentials } from '@hold-baby/bucket-db';

// 静态临时凭证
const withToken = new S3Adapter({
  bucket: 'my-app-bucket',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'ASIA...',
    secretAccessKey: '...',
    sessionToken: '...',
  },
});

// 异步凭证提供函数（如 STS / 自建凭证服务）
const withProvider = new S3Adapter({
  bucket: 'my-app-bucket',
  region: 'us-east-1',
  credentials: async (): Promise<Credentials> => {
    const res = await fetch('https://auth.example.com/s3-credentials');
    const body = await res.json();
    return {
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
      sessionToken: body.sessionToken,
      expiresAt: new Date(body.expiration),
    };
  },
});
```

提供函数的结果会被缓存，在 `expiresAt` 之前 5 分钟重新调用；没有 `expiresAt` 时不会再次调用。调用失败的结果不会被缓存。

### 兼容 S3 的服务

```typescript
// 例如本地 MinIO（未经官方测试）
const adapter = new S3Adapter({
  bucket: 'my-app-bucket',
  region: 'us-east-1',
  endpoint: 'http://localhost:9000',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
});
```

当 endpoint 的主机是 IP 或 `localhost` 时自动使用 path-style 地址；也可以用 `forcePathStyle: true` / `false` 显式指定。

## 阿里云 OSS

### 配置 OSSAdapter

```typescript
import { BucketDB, OSSAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface Order extends Document {
  userId: string;
  amount: number;
  status: 'pending' | 'completed' | 'cancelled';
}

const adapter = new OSSAdapter({
  bucket: 'my-app-bucket',
  region: 'cn-hangzhou',
  credentials: {
    accessKeyId: process.env.MY_OSS_KEY_ID!,
    secretAccessKey: process.env.MY_OSS_SECRET!,
  },
});

const db = new BucketDB(adapter, 'my-app');
const orders = db.collection<Order>('orders');

await orders.insert({ userId: 'user-123', amount: 99.99, status: 'pending' });
```

`region` 写 `cn-hangzhou`（0.3 的 `oss-cn-hangzhou` 写法仍然兼容）。`endpoint` 默认是 OSS 的 S3 兼容地址 `https://s3.oss-<region>.aliyuncs.com`。`credentials` 同样支持 `sessionToken` 和凭证提供函数。

### 使用环境变量

```bash
OSS_REGION=cn-hangzhou
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_secret_access_key
OSS_SESSION_TOKEN=...   # 可选，STS 临时凭证
```

没有 `OSS_*` 凭证时，会改读 `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_SECURITY_TOKEN`（`aliyun/configure-aliyun-credentials-action` 通过 OIDC 导出的就是这些变量，见 [CI 中使用](/guide/ci)）。

```typescript
const adapter = new OSSAdapter({ bucket: 'my-app-bucket' });

// 或者用 URL
const db = BucketDB.connect('oss://my-app-bucket/my-app?region=cn-hangzhou');
```

`OSS_ENDPOINT` 不会被读取；需要自定义地址时请传 `endpoint`。

::: tip 自定义域名
中国内地的新 OSS 用户可能需要通过 `endpoint` 使用自定义域名访问。通过自定义域名走 S3 兼容接口尚未验证。
:::

### OSS 上的更新

```typescript
import { UnsupportedError } from '@hold-baby/bucket-db';

// ✅ 不带 etag：普通 PUT，并发时后写覆盖
await orders.update(orderId, { status: 'completed' });

// ❌ 带 etag：不发送请求，直接抛出 UnsupportedError
try {
  await orders.update(orderId, { status: 'completed' }, { etag: current._etag });
} catch (error) {
  if (error instanceof UnsupportedError) {
    // OSS 不支持条件更新
  }
}
```

## 重试与超时

S3 和 OSS 适配器使用相同的重试策略：

- 每个请求最多尝试 3 次，全抖动指数退避。
- 单次尝试超时 `timeoutMs`，默认 10 000 ms。
- 会重试：网络错误、超时、500/502/503/504、429、`SlowDown`、`RequestTimeout`。其他 4xx 不重试（`kind: 'permanent'`）。
- 条件写入在之前的尝试失败后又收到冲突时，会重新读取对象并比较内容，不会因为自己上一次实际已成功的写入而误报冲突。

```typescript
const adapter = new S3Adapter({
  bucket: 'my-app-bucket',
  region: 'us-east-1',
  timeoutMs: 5000,
});
```

## 多环境配置

```typescript
import { BucketDB, S3Adapter, FileSystemAdapter } from '@hold-baby/bucket-db';

function createAdapter() {
  if (process.env.S3_BUCKET) {
    // region / 凭证从 AWS_* 环境变量读取
    return new S3Adapter({ bucket: process.env.S3_BUCKET });
  }
  return new FileSystemAdapter({ basePath: './dev-data' });
}

// 用 dbPath 隔离环境
const env = process.env.APP_ENV ?? 'development';
const db = new BucketDB(createAdapter(), env);
```

## 最佳实践

### 1. 不要硬编码凭证

```typescript
// ✅ 好：依赖环境变量或凭证提供函数
const adapter = new S3Adapter({ bucket: 'my-bucket' });

// ❌ 差：硬编码凭证
const bad = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: { accessKeyId: 'AKIAXXXXXXXX', secretAccessKey: 'xxxxxx' },
});
```

### 2. 错误处理

```typescript
import { StorageError } from '@hold-baby/bucket-db';

try {
  await users.insert({ name: 'Alice', email: 'alice@example.com' });
} catch (error) {
  if (error instanceof StorageError) {
    // kind: 'not-found' | 'conflict' | 'transient' | 'permanent'
    console.error(error.kind, error.status, error.key, error.message);
    // transient 表示重试后仍失败，可以稍后再试
  }
  throw error;
}
```

### 3. 复用实例

```typescript
// ✅ 复用 adapter 和 db 实例（凭证缓存等状态在实例内共享）
const db = new BucketDB(createAdapter(), 'my-app');
export { db };
```

### 4. 并发写入

`insert`、`put` 和 `delete` 可以并发执行；以已知 key 写入时用 `put(id, data)`，重试不会产生重复：

```typescript
await Promise.all(newUsers.map((u) => users.insert(u)));
await Promise.all(records.map((r) => events.put(r.requestId, r)));
```

不带 `etag` 的 `update` 在 S3 上遇到冲突会自动重新读取、合并并重试（最多 5 次），并发更新同一文档的不同字段都会生效；在 OSS 上后写覆盖。

### 5. 分页

`offset` / `limit` / `sort` 在过滤之后才在内存中应用，翻页不会减少请求数：

```typescript
const page1 = await users.find({}, { limit: 20, offset: 0 });
const newest = await users.find({}, { sort: { _createdAt: -1 }, limit: 20 });
const total = await users.count(); // 不带过滤条件时只 LIST，不读取文档
```

不传 `sort` 时默认按 `_createdAt` 升序、再按 `id` 升序，分页顺序稳定。

### 6. 查询快照、`compact()` 与日志

S3/OSS 上每个集合有一个快照 `<dbPath>/<collection>/_snapshot.v1.json`。查询先 LIST `docs/`，只使用 etag 一致的快照条目，因此快照缺失或过期只影响速度，不影响结果。变化的文档超过 16 个时查询会顺带重写快照。

- **只读凭证**可以直接使用：快照写入第一次遇到 401/403 后，该 `Collection` 实例不再尝试写入，查询照常工作（变化的文档会被逐个读取）。
- **删除敏感数据后调用 `compact()`**：已删除文档的内容会留在快照中，直到快照被重写；`compact()` 立即用当前文档重建快照，失败时抛出。
- **日志**：快照写入失败（`error`）和超出容量范围（`warn`）不会抛出，而是交给 `logger`：

```typescript
const db = new BucketDB(adapter, 'my-app', {
  logger: (event) => console.error(`[bucket-db] ${event.level}: ${event.message}`, event.error ?? '')
});

await db.collection('users').delete(userId);
await db.collection('users').compact();
```

## 限制

没有事务、容量范围、OSS 与 FileSystem 的条件更新限制等完整列表见[保证与限制](/guide/guarantees#限制)；实测耗时见 [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md)。

## 下一步

- [高级模式示例](./advanced) - 更多高级用法
- [存储适配器 API](/api/adapters) - 完整的适配器 API
