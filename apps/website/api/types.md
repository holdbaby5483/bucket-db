## Type Definitions

### Document

Base document type with system fields.

```typescript
interface Document {
  id: string;
  _etag?: string;
  _createdAt?: string;
  _updatedAt?: string;
}
```

All collection documents must extend this interface.

### InsertDocument<T>

Type for inserting new documents (omits system fields).

```typescript
type InsertDocument<T extends Document> = Omit<
  T,
  'id' | '_etag' | '_createdAt' | '_updatedAt'
>;
```

### UpdateDocument<T>

Type for updating documents (partial update without id).

```typescript
type UpdateDocument<T extends Document> = Partial<Omit<T, 'id'>>;
```

### QueryFilter<T>

Query filter for type-safe queries.

```typescript
type QueryFilter<T> = {
  [K in keyof T]?: QueryValue<T[K]>;
};
```

### QueryValue<T>

Query value can be direct value or operator object.

```typescript
type QueryValue<T> =
  | T
  | {
      $eq?: T;
      $ne?: T;
      $gt?: T;
      $gte?: T;
      $lt?: T;
      $lte?: T;
      $in?: T[];
      $nin?: T[];
    };
```

### QueryOptions

Query options for pagination.

```typescript
interface QueryOptions {
  limit?: number;
  offset?: number;
}
```

### UpdateOptions

Update options with optimistic locking.

```typescript
interface UpdateOptions {
  etag?: string;
}
```

---