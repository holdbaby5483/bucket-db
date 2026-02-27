## Error Classes

### BucketDBError

Base error class for all BucketDB errors.

```typescript
class BucketDBError extends Error {
  constructor(message: string);
}
```

### DocumentNotFoundError

Document not found error.

```typescript
class DocumentNotFoundError extends BucketDBError {
  constructor(id: string);
}
```

**Example:**
```typescript
try {
  await users.findById('non-existent');
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log('Document not found');
  }
}
```

### ConcurrentUpdateError

Concurrent update conflict error (ETag mismatch).

```typescript
class ConcurrentUpdateError extends BucketDBError {
  constructor(message?: string);
}
```

**Example:**
```typescript
try {
  await users.update('user-123', { age: 26 }, { etag: 'old-etag' });
} catch (error) {
  if (error instanceof ConcurrentUpdateError) {
    console.log('Concurrent update conflict, retry');
  }
}
```

### ValidationError

Validation error.

```typescript
class ValidationError extends BucketDBError {
  constructor(message: string);
}
```

### StorageError

Storage operation error.

```typescript
class StorageError extends BucketDBError {
  constructor(message: string, cause?: Error);
  readonly cause?: Error;
}
```

---