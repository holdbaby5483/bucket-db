# 错误处理

BucketDB 提供明确的错误类型，帮助你正确处理各种异常情况。

## 错误类型

下列错误类都继承自 `BucketDBError`：

```typescript
import {
  BucketDBError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError
} from '@hold-baby/bucket-db';
```

| 错误类 | 何时抛出 |
|--------|----------|
| `DocumentNotFoundError` | `update` / `delete` 的文档不存在（`findById` 返回 `null`，不抛出） |
| `ConcurrentUpdateError` | `update` 传入的 `etag` 已过期，或在 `update` 读取与写入之间文档被其他写入者修改；`delete` 没有 `etag` 参数，不会抛出 |
| `ValidationError` | 已导出，但当前版本不会抛出 |
| `StorageError` | 底层存储失败（S3、OSS、文件系统 I/O），包括"不存在"以外的索引分片读取错误 |

另外，非法名称会抛出 `PathValidationError`，它**未被导出**，且继承自 `Error` 而**不是** `BucketDBError`，见下文 [PathValidationError](#pathvalidationerror)。

## DocumentNotFoundError

当 `update()` 或 `delete()` 的目标文档不存在时抛出。

**触发场景**：
- `update()` 不存在的文档
- `delete()` 不存在的文档
- 上述方法传入非法 ID（会被当作不存在处理）

`findById()` 不会抛出此错误：文档不存在时返回 `null`。注意目前存储读取失败（如网络、权限错误）时 `findById()` 同样返回 `null`。

**处理方式**：

```typescript
try {
  await users.update('non-existent-id', { age: 26 });
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log('用户不存在');
  }
}
```

**最佳实践**：

```typescript
// 更新前先检查
const user = await users.findById(id);
if (!user) {
  throw new Error('User not found');
}

await users.update(id, updates);
```

## ConcurrentUpdateError

`update()` 检测到并发冲突时抛出。

**触发场景**：
- `update()` 时提供的 etag 与当前不匹配
- 在 `update()` 读取与写入之间，文档被其他写入者修改

`delete()` 没有 `etag` 参数，永远不会抛出 `ConcurrentUpdateError`。

::: warning OSS 不是原子的
`OSSAdapter` 用"先 HEAD 再 PUT"模拟条件写入，两个并发写入者（即使在同一进程内）可能同时通过检查。实测在 OSS 上用同一 `etag` 并发 10 次 `update` 全部成功，没有抛出 `ConcurrentUpdateError`。在 OSS 上请逐个等待写入完成；需要乐观锁请使用 S3。

在 S3、FileSystem、Memory 上，同一进程内的并发写入在竞争激烈时还可能以 `StorageError`（"PreconditionFailed"）失败，且失败前文档可能已写入。
:::

**处理方式 - 重试模式**：

```typescript
async function updateWithRetry(
  id: string,
  updates: Partial<User>,
  maxRetries: number = 3
): Promise<User> {
  let retries = maxRetries;

  while (retries > 0) {
    try {
      const user = await users.findById(id);
      if (!user) {
        throw new DocumentNotFoundError(id);
      }

      return await users.update(id, updates, { etag: user._etag });
    } catch (error) {
      if (error instanceof ConcurrentUpdateError && retries > 1) {
        retries--;
        // 指数退避
        await new Promise(resolve =>
          setTimeout(resolve, 100 * (maxRetries - retries + 1))
        );
        continue;
      }
      throw error;
    }
  }

  throw new Error('Update failed after retries');
}

// 使用
try {
  const updated = await updateWithRetry('user-123', { age: 26 });
  console.log('Updated successfully:', updated);
} catch (error) {
  console.error('Update failed:', error);
}
```

**处理方式 - 用户确认**：

```typescript
async function updateWithConfirmation(id: string, updates: Partial<User>) {
  const user = await users.findById(id);
  if (!user) throw new DocumentNotFoundError(id);

  try {
    return await users.update(id, updates, { etag: user._etag });
  } catch (error) {
    if (error instanceof ConcurrentUpdateError) {
      // 获取最新数据
      const latest = await users.findById(id);

      // 询问用户是否覆盖
      const confirmed = await askUserConfirmation(
        `数据已被修改，是否覆盖？`,
        { original: user, latest, updates }
      );

      if (confirmed) {
        // 强制更新（不使用 etag）
        return await users.update(id, updates);
      }
    }
    throw error;
  }
}
```

## ValidationError

已导出，但**当前版本不会抛出**。不要依赖它做输入校验；需要校验请在应用层自行完成。

## StorageError

底层存储操作失败时抛出。

**触发场景**：
- S3/OSS 请求失败（可重试的错误在重试耗尽后抛出）
- 文件系统权限或 I/O 错误
- 索引分片读取失败（"不存在"以外的错误）

**重试行为**：`S3Adapter` 使用 AWS SDK 默认重试（最多尝试 3 次，覆盖 5xx、429 和网络错误）；`OSSAdapter` 使用 ali-oss `retryMax: 2`，只重试网络错误和超时，**5xx 与 429 不重试**。

`findById()` 不会抛出 `StorageError`：读取失败目前返回 `null`。`insert`、`find`、`update`、`delete` 会抛出。

**处理方式**：

```typescript
try {
  const users = await collection.find({ status: 'active' });
} catch (error) {
  if (error instanceof StorageError) {
    console.error('存储错误:', error.message);
    console.error('原因:', error.cause);

    // 可能需要重试或降级
    return await fallbackHandler();
  }
}
```

## PathValidationError

集合名、文档 ID 或存储键不是安全的路径组件时抛出。它**未被导出**，且继承自 `Error` 而不是 `BucketDBError`，所以 `instanceof BucketDBError` 捕获不到，需要用 `error.name === 'PathValidationError'` 判断。

**规则**：
- 集合名和文档 ID 会先被清洗：`/` 和 `\` 替换为 `_`，`..` 被删除（`a/b` 实际存储为 `a_b`）。清洗结果必须非空、只包含字母/数字/`_`/`-`/`.`、不超过 255 个字符，且不能以 `.` 开头。
- 非法集合名：`db.collection()` 同步抛出 `PathValidationError`。
- 非法文档 ID：`findById()` 捕获错误并返回 `null`；`update()` / `delete()` 因此抛出 `DocumentNotFoundError`。
- `dbPath` 不做校验，BucketDB 用 Node 的 `path.join` 拼接它，会被规范化（例如 `./app/` 变成 `app`）；`FileSystemAdapter` 对包含 `..` 或解析到 `basePath` 之外的键抛出 `PathValidationError`。

```typescript
try {
  db.collection('.hidden');
} catch (error) {
  if (error instanceof Error && error.name === 'PathValidationError') {
    console.log('非法集合名:', error.message);
  }
}
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
import { BucketDBError } from '@hold-baby/bucket-db';
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
  const logEntry = {
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    context
  };

  if (error instanceof StorageError && error.cause) {
    logEntry.error.cause = {
      message: error.cause.message,
      stack: error.cause.stack
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

注意：`findById()` 不会抛出错误，文档不存在和读取失败目前都返回 `null`，无法区分。

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
    console.log('  Cause:', error.cause);
    console.log('  Stack:', error.stack);
  }
}
```

### 2. 检查存储状态

```typescript
// FileSystemAdapter
const adapter = new FileSystemAdapter({ basePath: './data' });
// 检查文件：ls -R ./data

// S3Adapter
// 使用 AWS CLI: aws s3 ls s3://bucket/my-app/
```

### 3. 验证数据完整性

```typescript
async function validateCollection(collection: Collection<any>) {
  const allDocs = await collection.find({});

  for (const doc of allDocs) {
    if (!doc.id) {
      console.error('Missing id:', doc);
    }
    if (!doc._etag) {
      console.error('Missing etag:', doc);
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
