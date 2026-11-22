# 高级模式示例

几个常用的组合用法。每段代码都是完整的，可以直接复制运行（`memory://` 换成你的连接 URL 即可）。

BucketDB 没有事务，每次写入只涉及一个文档；各后端的保证见[保证与限制](/guide/guarantees)。

## 乐观锁：读-改-写

不传 `etag` 时，`update` 在支持比较并交换的后端上已经会自动"读取 → 合并 → 条件写入"，冲突时重试，并发修改不同字段的局部更新都会生效。只有当新值依赖旧值（计数器、余额、列表追加）时，才需要自己读取文档、把 `_etag` 传给 `update`，冲突时重新读取并重新计算：

```typescript
import { BucketDB, ConcurrentUpdateError } from '@hold-baby/bucket-db';
import type { Collection, Document, Stored, UpdateDocument } from '@hold-baby/bucket-db';

async function updateWithRetry<T extends Document>(
  collection: Collection<T>,
  id: string,
  change: (current: Stored<T>) => UpdateDocument<T>,
  attempts = 3
): Promise<Stored<T>> {
  for (let attempt = 1; ; attempt++) {
    const current = await collection.findById(id);
    if (!current) throw new Error(`Document ${id} not found`);

    try {
      // 返回的文档是 Stored<T>，_etag 一定有值
      return await collection.update(id, change(current), { etag: current._etag });
    } catch (error) {
      if (!(error instanceof ConcurrentUpdateError) || attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 * attempt));
    }
  }
}

interface Counter extends Document {
  value: number;
}

const db = BucketDB.connect('memory://');
const counters = db.collection<Counter>('counters');

await counters.put('page-views', { value: 0 });
const updated = await updateWithRetry(counters, 'page-views', c => ({ value: c.value + 1 }));
console.log(updated.value); // 1
```

条件更新在 OSS 上不可用（带 `etag` 的 `update` 抛出 `UnsupportedError`），在 FileSystem 上只在单进程内有效。

## 分页

`offset` / `limit` / `sort` 在读取并过滤之后才在内存中应用，翻到第几页请求数都一样。不传 `sort` 时默认按 `_createdAt` 升序、再按 `id` 升序，顺序稳定，适合分页。多取一条即可判断是否还有下一页，不需要再查总数：

```typescript
import { BucketDB } from '@hold-baby/bucket-db';
import type { Collection, Document, QueryFilter, SortSpec, Stored } from '@hold-baby/bucket-db';

interface Page<T extends Document> {
  items: Stored<T>[];
  page: number;
  hasMore: boolean;
}

async function findPage<T extends Document>(
  collection: Collection<T>,
  filter: QueryFilter<T>,
  page: number,
  pageSize: number,
  sort?: SortSpec<T>
): Promise<Page<T>> {
  const rows = await collection.find(filter, {
    offset: (page - 1) * pageSize,
    limit: pageSize + 1,
    sort
  });
  return { items: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

interface User extends Document {
  name: string;
  status: 'active' | 'inactive';
}

const db = BucketDB.connect('memory://');
const users = db.collection<User>('users');

const first = await findPage(users, { status: 'active' }, 1, 20, { _createdAt: -1 });
console.log(first.items.length, first.hasMore);

// 需要总数时：不带过滤条件的 count() 只做 LIST；count(filter) 的成本与一次 find 相同
const total = await users.count();
```

需要遍历全部结果时，直接调用一次 `find(filter)`：逐页循环会让每一页都重新执行一次完整查询。

## CI 中的幂等写入

CI 任务会被重试或重新运行。用稳定的 key（commit sha、运行编号）作为文档 ID，配合 `put(id, data)`：每次是一次无条件 PUT，重复执行只会覆盖，不会产生重复文档。`put` 整体替换文档并重置 `_createdAt`。

```typescript
import { BucketDB } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface TestRun extends Document {
  sha: string;
  passed: boolean;
  durationMs: number;
}

// 读取 BUCKET_DB_URL，例如 s3://ci-data/my-repo?region=us-east-1
const db = BucketDB.connect();
const runs = db.collection<TestRun>('test-runs');

const sha = process.env.GITHUB_SHA ?? 'local';
await runs.put(sha, { sha, passed: true, durationMs: 81234 });
```

只允许创建一次（例如"每个 sha 只发布一次"）时用 `insert(data, { id })`：一次条件 PUT，ID 已被占用时抛出 `DocumentExistsError`，多个任务并发执行时恰好一个成功：

```typescript
import { BucketDB, DocumentExistsError } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface Release extends Document {
  sha: string;
  publishedAt: string;
}

const db = BucketDB.connect();
const releases = db.collection<Release>('releases');

const sha = process.env.GITHUB_SHA ?? 'local';
try {
  await releases.insert({ sha, publishedAt: new Date().toISOString() }, { id: sha });
  // 只有赢得竞争的任务会走到这里
} catch (error) {
  if (!(error instanceof DocumentExistsError)) throw error;
  console.log(`${sha} 已发布过，跳过`);
}
```

完整的 CI 用法（OIDC 凭证、命令行）见 [CI 中使用](/guide/ci)。

## 多租户：每个租户一个 dbPath

每个租户使用不同的 `dbPath`，数据位于 `<dbPath>/<collection>/docs/` 下，互不可见。`dbPath` 的每一段都必须匹配 `^[A-Za-z0-9_.-]{1,255}$` 且不能以 `.` 开头，否则 `new BucketDB(...)` 同步抛出 `ValidationError`（不会被改写），因此不合法的租户 ID 会在发出任何请求之前被拒绝。

```typescript
import { BucketDB, MemoryStorageAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  email: string;
}

// 所有租户共用一个适配器；生产中换成 S3Adapter / OSSAdapter
const adapter = new MemoryStorageAdapter();
const tenants = new Map<string, BucketDB>();

function tenantDB(tenantId: string): BucketDB {
  let db = tenants.get(tenantId);
  if (!db) {
    // tenants/tenant-a/users/docs/<id>.json
    db = new BucketDB(adapter, `tenants/${tenantId}`); // 不合法的 tenantId 抛出 ValidationError
    tenants.set(tenantId, db);
  }
  return db;
}

await tenantDB('tenant-a').collection<User>('users').insert({ name: 'Alice', email: 'alice@a.com' });
await tenantDB('tenant-b').collection<User>('users').insert({ name: 'Bob', email: 'bob@b.com' });

console.log(await tenantDB('tenant-a').collection<User>('users').count()); // 1
```

这种隔离只是 key 前缀：持有同一组凭证的代码可以读写所有租户的数据。需要权限隔离时，为每个租户使用只能访问其前缀的凭证。

## 下一步

- [基础用法](./basic-usage) - 基础 CRUD 操作
- [S3 / OSS 云存储](./production) - S3/OSS 配置
- [错误处理](/guide/error-handling) - 错误类与 `StorageError.kind`
- [API 参考](/api/) - 完整 API 文档
