# 错误处理

BucketDB 提供明确的错误类型，帮助你正确处理各种异常情况。

## 错误类型

所有 BucketDB 错误都继承自 `BucketDBError`：

```typescript
import {
  BucketDBError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError
} from '@hold-baby/bucket-db-core';
```

## DocumentNotFoundError

当尝试访问不存在的文档时抛出。

**触发场景**：
- `findById()` 返回 `null`（不抛出错误）
- `update()` 不存在的文档
- `delete()` 不存在的文档

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

并发更新冲突，ETag 不匹配时抛出。

**触发场景**：
- `update()` 时提供的 etag 与当前不匹配
- 两个并发更新同一文档

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

数据验证失败时抛出（未来版本可能使用）。

```typescript
try {
  await users.insert({ name: '' });  // 假设 name 不能为空
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('验证失败:', error.message);
  }
}
```

## StorageError

底层存储操作失败时抛出。

**触发场景**：
- S3/OSS 连接失败
- 文件系统权限错误
- 网络超时

**处理方式**：

```typescript
try {
  const user = await users.findById('user-123');
} catch (error) {
  if (error instanceof StorageError) {
    console.error('存储错误:', error.message);
    console.error('原因:', error.cause);

    // 可能需要重试或降级
    return await fallbackHandler();
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
import { BucketDBError } from '@hold-baby/bucket-db-core';
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
  const user = await users.findById(id);
  if (!user) {
    return null;  // 或抛出自定义错误
  }
  return user;
} catch (error) {
  logger.error('Failed to fetch user', { error, userId: id });
  throw error;
}

// ❌ 差：不处理错误
const user = await users.findById(id);  // 可能抛出错误
```

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
import { BucketDB, StorageError } from '@hold-baby/bucket-db-core';

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
