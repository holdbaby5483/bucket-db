# 错误处理

BucketDB 提供明确的错误类型，帮助你正确处理各种异常情况。

## 错误类型

下列错误类都继承自 `BucketDBError`：

```typescript
import {
  BucketDBError,
  ValidationError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  UnsupportedError,
  StorageError
} from '@hold-baby/bucket-db';
```

| 错误类 | 何时抛出 |
|--------|----------|
| `ValidationError` | 非法的集合名、文档 ID、`dbPath`；非法查询条件；比较操作符类型不匹配；适配器配置错误；缺少凭证 |
| `DocumentNotFoundError` | `update` 的文档不存在（`findById` 返回 `null`，`delete` 静默成功） |
| `ConcurrentUpdateError` | `etag` 已过期、带 `etag` 的写入输掉竞争，或不带 `etag` 的 `update` 自动重试耗尽 |
| `UnsupportedError` | 操作需要后端不具备的能力（OSS 上带 `etag` 的 `update`） |
| `StorageError` | 底层存储失败（S3、OSS、文件系统 I/O），带 `kind` / `key` / `status` |

## 各操作的错误行为

| 操作 | 文档不存在 | 其他错误 |
|------|------------|----------|
| `insert` | — | `StorageError` 等 |
| `findById` | 返回 `null` | 抛出（如 `StorageError`），不会返回 `null` |
| `find` | — | `ValidationError`（查询条件）、`StorageError` |
| `update` | `DocumentNotFoundError` | `ConcurrentUpdateError`、`UnsupportedError`、`StorageError` |
| `delete` | 静默成功（幂等） | `StorageError` |

## ValidationError

输入不合法时抛出，**不会**自动修正输入。

**触发场景**：
- 集合名、文档 ID 或 `dbPath` 的某一段不匹配 `^[A-Za-z0-9_.-]{1,255}$`，或以 `.` 开头（`dbPath` 为 `''` 表示 bucket 根目录）
- 查询条件包含保留字段名（`__proto__`、`constructor`、`prototype`、`toString` 等）、未知操作符，或 `$in` / `$nin` 的操作数不是数组
- 比较操作符（`$gt` 等）的类型不匹配
- 适配器构造参数错误（缺少 bucket / region、endpoint 非法）
- 缺少凭证（在第一次请求时抛出）

`new BucketDB(...)` 和 `db.collection(name)` 同步抛出；`findById` / `update` / `delete` 遇到非法 ID 时返回 rejected promise。`find({ id: 'bad/id' })` 不报错，返回 `[]`。

```typescript
try {
  db.collection('a/b');
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('非法集合名:', error.message);
  }
}
```

## DocumentNotFoundError

只在 `update()` 的目标文档不存在时抛出。

- `findById()` 文档不存在时返回 `null`；读取失败（网络、权限等）会抛出错误，不会返回 `null`
- `delete()` 是幂等的，删除不存在的文档不报错

```typescript
try {
  await users.update('non-existent-id', { age: 26 });
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log('用户不存在');
  }
}
```

## ConcurrentUpdateError

`update()` 检测到并发冲突时抛出。

**触发场景**：
- 传入的 `etag` 与当前不匹配
- 带 `etag` 的条件写入输掉了与其他写入者的竞争
- 不带 `etag` 的 `update` 在冲突后自动重试耗尽（最多重试 5 次）

**不带 `etag` 的 `update` 已经自动重试**：在支持 compare-and-swap 的后端（Memory、单进程内的 FileSystem、S3）上，`update(id, data)` 读取、合并后条件写入；遇到冲突会重新读取并重试，所以并发修改不同字段的局部更新都会生效，无需自己写重试循环。在 OSS 上它是普通 PUT，后写覆盖。

**读-改-写需要显式 `etag`**：当新值依赖旧值（如计数器、余额）时，读取文档并把 `_etag` 传给 `update`，冲突时重新读取并重新计算：

```typescript
async function incrementBalance(id: string, amount: number, maxRetries = 3): Promise<Account> {
  for (let attempt = 0; ; attempt++) {
    const account = await accounts.findById(id);
    if (!account) throw new Error(`Account ${id} not found`);

    try {
      return await accounts.update(
        id,
        { balance: account.balance + amount },
        { etag: account._etag }
      );
    } catch (error) {
      if (error instanceof ConcurrentUpdateError && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
        continue;
      }
      throw error;
    }
  }
}
```

::: warning 后端差异
- **OSS**：不支持条件更新，带 `etag` 的 `update` 抛出 `UnsupportedError`（不发送请求）
- **FileSystem**：条件更新只在单进程内有效
:::

**处理方式 - 用户确认**：

```typescript
async function updateWithConfirmation(id: string, updates: UpdateDocument<User>) {
  const user = await users.findById(id);
  if (!user) throw new Error(`User ${id} not found`);

  try {
    return await users.update(id, updates, { etag: user._etag });
  } catch (error) {
    if (error instanceof ConcurrentUpdateError) {
      const latest = await users.findById(id);

      const confirmed = await askUserConfirmation(
        `数据已被修改，是否覆盖？`,
        { original: user, latest, updates }
      );

      if (confirmed) {
        // 不带 etag 覆盖这些字段
        return await users.update(id, updates);
      }
    }
    throw error;
  }
}
```

## UnsupportedError

操作需要存储后端不具备的能力时抛出。目前唯一的场景是在 `OSSAdapter` 上调用带 `etag` 的 `update`。

```typescript
try {
  await users.update(id, updates, { etag: user._etag });
} catch (error) {
  if (error instanceof UnsupportedError) {
    // 该后端不支持条件更新
  }
}
```

## StorageError

底层存储操作失败时抛出。

| 属性 | 类型 | 说明 |
|------|------|------|
| `kind` | `'not-found' \| 'conflict' \| 'transient' \| 'permanent'` | 失败类型；`transient` 表示可重试的失败在重试后仍未成功 |
| `key` | `string \| undefined` | 相关的存储键 |
| `status` | `number \| undefined` | HTTP 状态码（S3 / OSS） |
| `cause` | `unknown` | 原始错误 |

**触发场景**：
- S3 / OSS 请求失败
- 文件系统权限或 I/O 错误
- `docs/` 下有不是 `<合法 ID>.json` 或不是 JSON 对象的文件（`find` 抛出，`error.key` 指向该文件）

**重试行为**：S3 和 OSS 的内置客户端已对每个请求最多尝试 3 次（全抖动指数退避，单次超时 `timeoutMs` 默认 10 000 ms），重试网络错误、超时、5xx（500/502/503/504）、429、`SlowDown`、`RequestTimeout`。其他 4xx 不重试（`kind: 'permanent'`）。因此收到 `kind: 'transient'` 时内部已经重试过，应用层只需决定是否稍后再试。

```typescript
try {
  const users = await collection.find({ status: 'active' });
} catch (error) {
  if (error instanceof StorageError) {
    console.error('存储错误:', error.kind, error.status, error.key, error.message);

    if (error.kind === 'transient') {
      return await fallbackHandler();
    }
  }
  throw error;
}
```

自定义适配器构造 `StorageError` 时使用选项对象：

```typescript
throw new StorageError('read failed', { kind: 'transient', key, status: 503, cause: err });
```

## 通用错误处理

### 1. 统一错误处理器

```typescript
async function handleDBOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      console.error('文档不存在:', error.message);
      throw new AppError('DOCUMENT_NOT_FOUND', 404);
    }

    if (error instanceof ConcurrentUpdateError) {
      console.error('并发冲突:', error.message);
      throw new AppError('CONFLICT', 409);
    }

    if (error instanceof ValidationError) {
      throw new AppError('BAD_REQUEST', 400);
    }

    if (error instanceof StorageError) {
      console.error('存储错误:', error.message);
      throw new AppError('STORAGE_ERROR', 500);
    }

    // 未知错误
    console.error('未知错误:', error);
    throw new AppError('INTERNAL_ERROR', 500);
  }
}

// 使用
const user = await handleDBOperation(() =>
  users.findById('user-123')
);
```

### 2. Express 中间件

```typescript
import {
  BucketDBError,
  ConcurrentUpdateError,
  DocumentNotFoundError,
  ValidationError
} from '@hold-baby/bucket-db';
import type { Request, Response, NextFunction } from 'express';

function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof DocumentNotFoundError) {
    return res.status(404).json({ error: 'Resource not found' });
  }

  if (err instanceof ConcurrentUpdateError) {
    return res.status(409).json({ error: 'Conflict, please retry' });
  }

  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }

  if (err instanceof BucketDBError) {
    return res.status(500).json({ error: 'Database error' });
  }

  // 其他错误
  next(err);
}

app.use(errorHandler);
```

### 3. 日志记录

```typescript
function logError(error: Error, context: Record<string, any>) {
  const logEntry: Record<string, any> = {
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    context
  };

  if (error instanceof StorageError) {
    logEntry.error.storage = {
      kind: error.kind,
      key: error.key,
      status: error.status,
      cause: String(error.cause)
    };
  }

  console.error(JSON.stringify(logEntry));
}

// 使用
try {
  await users.update(id, updates);
} catch (error) {
  logError(error as Error, { operation: 'update', userId: id });
  throw error;
}
```

## 最佳实践

### 1. 始终处理错误

```typescript
// ✅ 好：捕获并处理
try {
  return await users.find({ status: 'active' });
} catch (error) {
  logger.error('Failed to query users', { error });
  throw error;
}

// ❌ 差：不处理错误
const active = await users.find({ status: 'active' });  // 可能抛出 StorageError
```

`findById()` 只在文档不存在时返回 `null`；读取失败会抛出错误，同样需要处理。

### 2. 区分预期和非预期错误

```typescript
// 预期错误（业务逻辑）
const user = await users.findById(id);
if (!user) {
  return { error: 'User not found' };  // 正常处理
}

// 非预期错误（系统错误）
try {
  return await users.update(id, updates);
} catch (error) {
  // 记录并上报
  logger.error('Unexpected error', { error });
  throw error;
}
```

### 3. 提供有用的错误信息

```typescript
try {
  await users.update(id, updates);
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    throw new Error(`User ${id} not found`);
  }

  if (error instanceof ConcurrentUpdateError) {
    throw new Error(
      `User ${id} was modified by another request, please retry`
    );
  }

  throw error;
}
```

### 4. 使用类型守卫

```typescript
function isDocumentNotFound(error: unknown): error is DocumentNotFoundError {
  return error instanceof DocumentNotFoundError;
}

function isConcurrentUpdate(error: unknown): error is ConcurrentUpdateError {
  return error instanceof ConcurrentUpdateError;
}

// 使用
try {
  await users.update(id, updates);
} catch (error) {
  if (isDocumentNotFound(error)) {
    // TypeScript 知道这是 DocumentNotFoundError
    console.log(error.message);
  } else if (isConcurrentUpdate(error)) {
    // TypeScript 知道这是 ConcurrentUpdateError
    await retryUpdate();
  }
}
```

## 调试技巧

### 1. 启用详细日志

```typescript
import { BucketDB, StorageError } from '@hold-baby/bucket-db';

try {
  // 操作
} catch (error) {
  if (error instanceof StorageError) {
    console.log('Storage error details:');
    console.log('  Message:', error.message);
    console.log('  Kind:', error.kind);
    console.log('  Key:', error.key);
    console.log('  Status:', error.status);
    console.log('  Cause:', error.cause);
    console.log('  Stack:', error.stack);
  }
}
```

### 2. 检查存储状态

```typescript
// FileSystemAdapter
const adapter = new FileSystemAdapter({ basePath: './data' });
// 每个文档是一个文件：./data/<dbPath>/<collection>/docs/<id>.json

// S3Adapter
// 使用 AWS CLI: aws s3 ls s3://bucket/my-app/users/docs/
```

### 3. 验证数据完整性

```typescript
async function validateCollection(collection: Collection<any>) {
  const allDocs = await collection.find({});

  for (const doc of allDocs) {
    if (!doc.id) {
      console.error('Missing id:', doc);
    }
    if (!doc._createdAt || !doc._updatedAt) {
      console.error('Missing timestamps:', doc);
    }
  }
}
```

## 下一步

- [API 参考 - 错误类](/api/errors) - 完整的错误类 API
- [示例 - 高级模式](/examples/advanced) - 错误处理实例
