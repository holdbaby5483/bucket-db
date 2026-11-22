# 错误处理

BucketDB 抛出的每个错误都是下面某个错误类的实例。请按错误类和 `StorageError.kind` 判断，不要匹配错误消息文本（消息可能在版本之间改变，见[兼容策略](./compatibility)）。

## 错误类型

下列错误类都继承自 `BucketDBError`：

```typescript
import {
  BucketDBError,
  ValidationError,
  DocumentNotFoundError,
  DocumentExistsError,
  ConcurrentUpdateError,
  UnsupportedError,
  StorageError
} from '@hold-baby/bucket-db';
```

| 错误类 | 何时抛出 |
|--------|----------|
| `ValidationError` | 非法的集合名、文档 ID、`dbPath`；非法查询条件或查询选项（`limit` / `offset` / `sort`）；连接字符串错误；适配器配置错误；缺少凭证 |
| `DocumentNotFoundError` | `update` 的文档不存在（`findById` 返回 `null`，`delete` 静默成功） |
| `DocumentExistsError` | `insert(data, { id })` 的 ID 已被占用 |
| `ConcurrentUpdateError` | `etag` 已过期、带 `etag` 的写入输掉竞争，或不带 `etag` 的 `update` 自动重试耗尽 |
| `UnsupportedError` | 操作需要后端不具备的能力（OSS 上带 `etag` 的 `update`；`createIfAbsent` 为 `'none'` 的自定义后端上带 `id` 的 `insert`） |
| `StorageError` | 底层存储失败（S3、OSS、文件系统 I/O），带 `kind` / `key` / `status` |

## 各操作的错误行为

| 操作 | 文档不存在 | 其他错误 |
|------|------------|----------|
| `insert` | — | `DocumentExistsError`（指定的 `id` 已存在）、`ValidationError`（非法 `id`）、`StorageError` 等 |
| `put` | — | `ValidationError`（非法 `id`）、`StorageError` |
| `findById` | 返回 `null` | 抛出（如 `StorageError`），不会返回 `null` |
| `find` / `count` | — | `ValidationError`（查询条件或选项）、`StorageError`（S3/OSS 上包括读取快照时的暂时性或权限错误） |
| `update` | `DocumentNotFoundError` | `ConcurrentUpdateError`、`UnsupportedError`、`StorageError` |
| `delete` | 静默成功（幂等） | `StorageError` |
| `deleteMany` | — | `ValidationError`、`StorageError`（中途失败时已完成的删除不会恢复） |
| `compact` | — | `StorageError` 等（失败即抛出） |

以下情况**不会抛出**，而是交给创建数据库时传入的 `logger`（默认 `console.warn`，见[核心概念 · 日志](./concepts#日志-logger)）：

- S3/OSS 上查询顺带写快照失败：`level: 'error'`，查询照常返回；遇到 401/403（如只读凭证）后该 `Collection` 实例不再尝试写快照
- 快照内容无法解析（会被重建）：`level: 'warn'`
- 集合超出[容量范围](./guarantees#限制)：每个 `Collection` 实例一次 `level: 'warn'`

## ValidationError

输入不合法时抛出，**不会**自动修正输入，并且在发出任何存储请求之前抛出。

**触发场景**：
- 集合名、文档 ID 或 `dbPath` 的某一段不匹配 `^[A-Za-z0-9_.-]{1,255}$`，或以 `.` 开头（`dbPath` 为 `''` 表示 bucket 根目录）
- 查询条件包含保留字段名（`__proto__`、`constructor`、`prototype`、`toString` 等）、未知操作符，或 `$in` / `$nin` 的操作数不是数组
- `limit` / `offset` 为负数或小数；`sort` 的方向不是 `1` / `-1` 或字段为保留名称
- 连接字符串错误：没有传 URL 也没有设置 `BUCKET_DB_URL`、不支持的协议、未知参数、s3/oss 缺少 bucket、URL 中包含凭证（错误信息不会重复 URL）
- 适配器构造参数错误（缺少 bucket / region、endpoint 非法）
- 缺少凭证（在第一次请求时抛出）

类型不同的比较（如文档中 `age` 是字符串而查询用数字）不会报错，只是不匹配，见[匹配规则](./queries#匹配规则)。

`new BucketDB(...)` 和 `db.collection(name)` 同步抛出；`findById` / `update` / `delete` 遇到非法 ID 时返回 rejected promise。`find({ id: 'bad/id' })` 不报错，返回 `[]`。

```typescript
import { BucketDB, ValidationError } from '@hold-baby/bucket-db';

const db = BucketDB.connect('memory://');

try {
  db.collection('a/b');
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('非法集合名:', error.message);
  }
}
```

## DocumentNotFoundError

只在 `update()` 的目标文档不存在时抛出。`findById()` 文档不存在时返回 `null`；`delete()` 是幂等的，删除不存在的文档不报错。

```typescript
import { BucketDB, DocumentNotFoundError } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  age: number;
}

const users = BucketDB.connect('memory://').collection<User>('users');

try {
  await users.update('non-existent-id', { age: 26 });
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log('用户不存在');
  } else {
    throw error;
  }
}
```

## DocumentExistsError

`insert(data, { id })` 指定的 ID 已被占用时抛出。多个进程同时用同一个 ID 插入时，恰好一个成功，其余抛出此错误。需要覆盖而不是报错时使用 `put(id, data)`。

```typescript
import { BucketDB, DocumentExistsError } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface Run extends Document {
  status: 'started' | 'finished';
}

const runs = BucketDB.connect('memory://').collection<Run>('runs');
const runId = 'run-42';

try {
  await runs.insert({ status: 'started' }, { id: runId });
} catch (error) {
  if (error instanceof DocumentExistsError) {
    console.log('该运行已记录过:', runId);
  } else {
    throw error;
  }
}
```

## ConcurrentUpdateError

`update()` 检测到并发冲突时抛出：

- 传入的 `etag` 与当前不匹配
- 带 `etag` 的条件写入输掉了与其他写入者的竞争
- 不带 `etag` 的 `update` 在冲突后自动重试耗尽（最多重试 5 次）

不带 `etag` 的 `update` 在支持比较并交换的后端上已经自动重试，并发修改不同字段的局部更新都会生效，无需自己写重试循环。当新值依赖旧值（计数器、余额）时，读取文档并把 `_etag` 传给 `update`，收到 `ConcurrentUpdateError` 后重新读取、重新计算。可复用的写法见[高级模式 · 乐观锁](/examples/advanced#乐观锁-读-改-写)。

```typescript
import { BucketDB, ConcurrentUpdateError } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface Account extends Document {
  balance: number;
}

const accounts = BucketDB.connect('memory://').collection<Account>('accounts');
const account = await accounts.insert({ balance: 100 });

try {
  await accounts.update(account.id, { balance: account.balance - 30 }, { etag: account._etag });
} catch (error) {
  if (error instanceof ConcurrentUpdateError) {
    // 其他写入者先修改了这个文档：重新读取后再计算
  } else {
    throw error;
  }
}
```

哪些后端支持条件更新见[保证与限制](./guarantees#各后端)。

## UnsupportedError

操作需要存储后端不具备的能力时抛出，且不发送任何请求。内置适配器上唯一的场景是在 `OSSAdapter` 上调用带 `etag` 的 `update`；在 `capabilities.createIfAbsent` 为 `'none'` 的自定义适配器上，带 `id` 的 `insert` 也会抛出。这是配置问题而不是暂时性错误，重试没有意义：去掉 `etag`，或改用支持条件更新的后端。

## StorageError

底层存储操作失败时抛出。

| 属性 | 类型 | 说明 |
|------|------|------|
| `kind` | `'not-found' \| 'conflict' \| 'transient' \| 'permanent'` | 失败类型，见下表 |
| `key` | `string \| undefined` | 相关的存储键 |
| `status` | `number \| undefined` | HTTP 状态码（S3 / OSS） |
| `cause` | `unknown` | 原始错误 |

| `kind` | 含义 | 处理方式 |
|--------|------|----------|
| `'transient'` | 可重试的失败（网络错误、超时、5xx、429、`SlowDown`、`RequestTimeout`）在内置客户端重试后仍未成功 | 稍后再试 |
| `'permanent'` | 其他失败：权限（401/403）、`docs/` 下不是 JSON 对象的文件、文件系统 I/O 错误等 | 检查配置、权限或 `error.key` 指向的对象，不要重试 |
| `'not-found'` / `'conflict'` | 对象不存在 / 写入条件不满足。集合把它们转换为 `null`、`DocumentExistsError`、`ConcurrentUpdateError` 等，通常只在直接调用适配器时见到 | — |

**触发场景**：
- S3 / OSS 请求失败
- 文件系统权限或 I/O 错误
- `docs/` 下有不是 `<合法 ID>.json` 或不是 JSON 对象的文件（`find` 抛出，`error.key` 指向该文件）
- S3 / OSS 上 `find` 读取快照时遇到暂时性错误或权限错误（查询失败，而不是改为逐个读取文档）

**重试行为**：S3 和 OSS 的内置客户端对每个请求最多尝试 3 次（全抖动指数退避，单次超时 `timeoutMs` 默认 10 000 ms）。因此收到 `kind: 'transient'` 时内部已经重试过，应用层只需决定是否稍后再试：

```typescript
import { StorageError } from '@hold-baby/bucket-db';

async function retryTransient<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const transient = error instanceof StorageError && error.kind === 'transient';
      if (!transient || attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

只对重复执行结果相同的操作这样重试：读取、`put`、`delete`、带 `id` 的 `insert`。不带 `id` 的 `insert` 在暂时性失败时可能已经写入，重试会产生第二个文档。

存储服务本身是否提供所需的保证，可以用 [`bucket-db doctor`](./cli#doctor) 检查。

自定义适配器构造 `StorageError` 时使用选项对象：

```typescript
import { StorageError } from '@hold-baby/bucket-db';

function readFailed(key: string, cause: unknown): StorageError {
  return new StorageError('read failed', { kind: 'transient', key, status: 503, cause });
}
```

## 映射为 HTTP 状态码

下面的映射假设 ID 和过滤条件来自请求。`ValidationError` 也用于连接字符串、适配器参数和缺少凭证等配置错误，这类错误不应作为 400 返回给客户端。

```typescript
import {
  ConcurrentUpdateError,
  DocumentExistsError,
  DocumentNotFoundError,
  StorageError,
  ValidationError
} from '@hold-baby/bucket-db';

function httpStatusOf(error: unknown): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof DocumentNotFoundError) return 404;
  if (error instanceof DocumentExistsError || error instanceof ConcurrentUpdateError) return 409;
  if (error instanceof StorageError && error.kind === 'transient') return 503;
  return 500;
}
```

## 下一步

- [API 参考 - 错误类](/api/errors) - 完整的错误类 API
- [保证与限制](./guarantees) - 各后端的保证与已知限制
- [示例 - 高级模式](/examples/advanced) - 乐观锁、幂等写入等用法
