# Migrating from 0.5 to 0.6

0.6.0 is the last breaking release before 1.0. It settles the public types: `Collection` is a type only, returned documents always carry `_etag`, `sort` keys are type-checked, and Node.js 22 is the minimum. The storage format, the CLI, connection URLs, the MCP server and runtime behaviour are unchanged, apart from one relaxation (`sort` fields set to `undefined`, below). 0.5 and 0.6 clients can share a collection. Upgrading from 0.4 or 0.3.x: read [MIGRATION-0.5.md](./MIGRATION-0.5.md) (and [MIGRATION-0.4.md](./MIGRATION-0.4.md)) first.

```bash
npm install @hold-baby/bucket-db@0.6.0
```

**Who is affected:** code that calls `new Collection(...)`, imports `CollectionOptions` or uses `Collection` as a value (`instanceof`); code that sorts on fields its document type does not declare; anyone running on Node.js 20. Code that only uses `BucketDB`, `db.collection<T>(name)` and typed documents compiles unchanged.

## Breaking changes

### `Collection` is a type only

`Collection` is exported with `export type`, so it can annotate variables but not be constructed or used with `instanceof`. Collections come only from `db.collection(name)`. `CollectionOptions` is no longer exported; set the logger on the `BucketDB`, which passes it to every collection.

```typescript
// 0.5
import { Collection } from '@hold-baby/bucket-db';
import type { CollectionOptions } from '@hold-baby/bucket-db';
const users = new Collection<User>(adapter, 'my-app', 'users', { logger });

// 0.6
import { BucketDB } from '@hold-baby/bucket-db';
import type { Collection } from '@hold-baby/bucket-db';
const db = new BucketDB(adapter, 'my-app', { logger }); // or BucketDB.connect(url, { logger })
const users: Collection<User> = db.collection<User>('users');
```

`db.collection(name)` returns the same instance for the same name, so share the `BucketDB` rather than collections built by hand.

### Returned documents are `Stored<T>`

`insert`, `put`, `findById`, `find` and `update` return `Stored<T>` = `T & { _etag: string }` (exported). `_etag` is always set, so the non-null assertion is no longer needed. `_createdAt` and `_updatedAt` stay optional, because a file placed in `docs/` by hand may lack them.

```typescript
// 0.5
const user = await users.findById(id);
if (user) await users.update(id, { age: 31 }, { etag: user._etag! });

// 0.6
const user = await users.findById(id); // Stored<User> | null
if (user) await users.update(id, { age: 31 }, { etag: user._etag });
```

A `Stored<T>` is assignable to `T`, so annotations such as `const user: User = await users.insert(...)` keep compiling. What no longer compiles is putting a plain `T` where a `Stored<T>` is expected, for example pushing a hand-built object into an array returned by `find`; type such arrays as `T[]`.

### `sort` keys are type-checked

`QueryOptions` takes the document type, `QueryOptions<T = Document>`, and its `sort` is `SortSpec<T>` (exported): the fields of `T` plus `id`, `_etag`, `_createdAt` and `_updatedAt`, each `1` or `-1`. A misspelt or undeclared field is a compile error instead of a sort that silently does nothing useful.

```typescript
// 0.5: compiled; `createdAt` is not a field, so every document sorted as missing
await users.find({}, { sort: { createdAt: -1 } });

// 0.6: compile error; use the system field
await users.find({}, { sort: { _createdAt: -1 } });

// 0.5
const options: QueryOptions = { sort: { age: -1 }, limit: 10 };
// 0.6: give QueryOptions the document type
const options: QueryOptions<User> = { sort: { age: -1 }, limit: 10 };
```

A collection obtained without a type argument, `db.collection('users')`, is a `Collection<Document>` and can only sort by the system fields; declare the document type, `db.collection<User>('users')`.

At runtime a `sort` field whose direction is `undefined` is now ignored (0.5 threw `ValidationError`), so `{ sort: { age: descending ? -1 : undefined } }` works. Other values than `1` / `-1` still throw.

### Node.js 22 or later

`engines.node` is `>=22`; CI tests Node 22 and 24 (and Bun). Node 20 reached end of life on 2026-04-30 and is no longer tested. npm prints an `EBADENGINE` warning when installing on Node 20, or refuses with `engine-strict`. Upgrade the runtime of the application, CI jobs and anything running `npx @hold-baby/bucket-db`.

## New, no changes needed

- Exported types `Stored<T>` and `SortSpec<T>`.
- `bun run --cwd packages/core typecheck` compiles the source and `packages/core/tests/types/public-api.ts`, which pins the public types; CI runs it. See [GUARANTEES.md](./GUARANTEES.md#public-api-types).

## Running 0.5 and 0.6 side by side

0.6 changes types, not what is written: the storage format and the write paths are the same as in 0.5, so 0.5 and 0.6 clients can read and write the same collections. This follows from the code; no test runs the two versions against each other.

## See also

- [CHANGELOG.md](../CHANGELOG.md)
- [API.md](./API.md)
- [GUARANTEES.md](./GUARANTEES.md)
