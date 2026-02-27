# Collection 类

集合类,提供类型安全的 CRUD 操作。

### Collection<T>

Type-safe collection for CRUD operations.

#### Methods

##### `insert(data: InsertDocument<T>): Promise<T>`

Insert a new document.

**Parameters:**
- `data` - Document data (without `id`, `_etag`, `_createdAt`, `_updatedAt`)

**Returns:** Complete document with system fields

**Example:**
```typescript
const user = await users.insert({
  name: 'Alice',
  email: 'alice@example.com',
});
// Returns: { id: '...', name: 'Alice', email: '...', _etag: '...', _createdAt: '...', _updatedAt: '...' }
```

##### `findById(id: string): Promise<T | null>`

Find document by ID.

**Parameters:**
- `id` - Document ID

**Returns:** Document or `null` if not found

**Example:**
```typescript
const user = await users.findById('user-123');
if (user) {
  console.log(user.name);
}
```

##### `find(filter: QueryFilter<T>, options?: QueryOptions): Promise<T[]>`

Query documents with filter.

**Parameters:**
- `filter` - Query filter object
- `options` - Query options
  - `limit?: number` - Maximum number of results
  - `offset?: number` - Number of results to skip

**Returns:** Array of matching documents

**Example:**
```typescript
// Simple equality
const active = await users.find({ status: 'active' });

// Comparison operators
const adults = await users.find({ age: { $gte: 18 } });

// Multiple conditions
const results = await users.find({
  status: 'active',
  age: { $gte: 18, $lt: 65 },
});

// Pagination
const page1 = await users.find({}, { limit: 10, offset: 0 });
const page2 = await users.find({}, { limit: 10, offset: 10 });
```

##### `update(id: string, data: UpdateDocument<T>, options?: UpdateOptions): Promise<T>`

Update existing document.

**Parameters:**
- `id` - Document ID
- `data` - Partial document update (cannot change `id`)
- `options` - Update options
  - `etag?: string` - ETag for optimistic locking

**Returns:** Updated document

**Throws:**
- `DocumentNotFoundError` - Document not found
- `ConcurrentUpdateError` - ETag mismatch (concurrent modification)

**Example:**
```typescript
// Simple update
const updated = await users.update('user-123', { age: 26 });

// With optimistic locking
const user = await users.findById('user-123');
const updated = await users.update(
  'user-123',
  { age: 26 },
  { etag: user._etag }
);
```

##### `delete(id: string): Promise<void>`

Delete document.

**Parameters:**
- `id` - Document ID

**Throws:**
- `DocumentNotFoundError` - Document not found

**Example:**
```typescript
await users.delete('user-123');
```

---
