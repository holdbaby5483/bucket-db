# 本地存储示例

使用 FileSystemAdapter 进行本地持久化存储。

> 💡 以下代码为简化版本，展示 Todo 场景。完整源码见 `examples/local-storage/index.ts`（使用 User 接口）。

## 完整代码

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface Todo extends Document {
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
}

const basePath = './local-db-data';

async function main() {
  // 创建 FileSystemAdapter
  const adapter = new FileSystemAdapter({ basePath });

  const db = new BucketDB(adapter, 'todo-app');
  const todos = db.collection<Todo>('todos');

  console.log('=== 添加待办事项 ===');

  const todo1 = await todos.insert({
    title: '学习 BucketDB',
    completed: false,
    priority: 'high'
  });
  console.log('Created:', todo1.title);

  const todo2 = await todos.insert({
    title: '写文档',
    completed: false,
    priority: 'medium'
  });
  console.log('Created:', todo2.title);

  const todo3 = await todos.insert({
    title: '测试代码',
    completed: true,
    priority: 'high'
  });
  console.log('Created:', todo3.title);

  console.log('\n=== 查询高优先级任务 ===');

  const highPriority = await todos.find({ priority: 'high' });
  console.log('High priority tasks:');
  highPriority.forEach(todo => {
    console.log(`  - [${todo.completed ? 'x' : ' '}] ${todo.title}`);
  });

  console.log('\n=== 完成任务 ===');

  await todos.update(todo1.id, { completed: true });
  console.log('Marked as completed:', todo1.title);

  console.log('\n=== 查询未完成任务 ===');

  const pending = await todos.find({ completed: false });
  console.log('Pending tasks:');
  pending.forEach(todo => {
    console.log(`  - [${todo.priority}] ${todo.title}`);
  });

  console.log('\n=== 数据已保存到本地 ===');
  console.log('数据目录:', basePath);
  console.log('重启程序后数据仍然存在');
}

main().catch(console.error);
```

## 运行结果

```
=== 添加待办事项 ===
Created: 学习 BucketDB
Created: 写文档
Created: 测试代码

=== 查询高优先级任务 ===
High priority tasks:
  - [ ] 学习 BucketDB
  - [x] 测试代码

=== 完成任务 ===
Marked as completed: 学习 BucketDB

=== 查询未完成任务 ===
Pending tasks:
  - [medium] 写文档

=== 数据已保存到本地 ===
数据目录: ./local-db-data
重启程序后数据仍然存在
```

## 目录结构

每个文档对应一个 JSON 文件，路径为 `basePath/<dbPath>/<collection>/docs/<id>.json`。没有索引文件，也没有其他元数据文件：

```
local-db-data/
└── todo-app/
    └── todos/
        └── docs/
            ├── a1b2c3d4-...-uuid.json
            ├── e5f6a7b8-...-uuid.json
            └── c9d0e1f2-...-uuid.json
```

写入时会先写临时文件 `<path>.<uuid>.tmp`，再通过 `link()`（新建）或 `rename()`（覆盖）原子替换。`find` 会忽略 `*.tmp` 文件和以 `.` 开头的隐藏文件（如 `.DS_Store`）。`docs/` 下其他不是 `<合法 id>.json` 或不是 JSON 对象的文件会让 `find` 抛出 `StorageError`（`error.key` 指明文件）。

## 文件内容示例

### 文档文件（docs/a1b2c3d4-...-uuid.json）

```json
{
  "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "title": "学习 BucketDB",
  "completed": true,
  "priority": "high",
  "_createdAt": "2026-02-28T10:00:00.000Z",
  "_updatedAt": "2026-02-28T10:05:00.000Z"
}
```

`_etag` 不写入文件，读取时由存储层生成（FileSystem 下由 inode、修改时间和文件大小组成）；`id` 也以文件名为准。手动放到 `docs/<id>.json` 的 JSON 对象同样会被当作文档读取。

## 要点说明

### 1. 数据持久化

FileSystemAdapter 会将所有数据保存到本地文件系统：

```typescript
const adapter = new FileSystemAdapter({
  basePath: './local-db-data'  // 数据保存路径
});
```

### 2. 重启后数据保留

```typescript
// 第一次运行
const db1 = new BucketDB(adapter, 'todo-app');
await db1.collection<Todo>('todos').insert({ title: 'Task 1', completed: false, priority: 'low' });

// 重启程序后
const db2 = new BucketDB(adapter, 'todo-app');
const all = await db2.collection<Todo>('todos').find({});
// all 包含之前插入的数据
```

### 3. .gitignore 配置

建议忽略本地数据库文件：

```gitignore
# .gitignore
local-db-data/
```

### 4. 多环境配置

```typescript
const basePath = process.env.DATA_DIR ?? './local-db-data';

const adapter = new FileSystemAdapter({ basePath });
```

### 5. 多进程

- `insert` 和 `delete` 在多个进程同时写入同一集合时是安全的（`insert` 通过 `link()` 实现跨进程的"不存在才创建"）。
- 带 `etag` 的条件更新，以及不带 `etag` 时的并发合并更新，只在单个进程内有效：比较并替换由进程内的锁串行化，多个进程同时 `update` 同一文档可能后写覆盖。

### 6. 测试时使用内存适配器

`MemoryStorageAdapter` 不持久化任何数据；每个测试需要干净的数据时，新建一个实例即可：

```typescript
import { MemoryStorageAdapter } from '@hold-baby/bucket-db';

const db = new BucketDB(new MemoryStorageAdapter(), 'test');
```

## 适用场景

- ✅ 本地开发和测试
- ✅ 桌面应用、CLI 工具
- ✅ 单机服务（多个进程可以同时插入、删除；更新同一文档需在单进程内完成）
- ❌ 多台机器共享写入（请使用 [S3 / OSS 云存储](./production)）

## 下一步

- [S3 / OSS 云存储示例](./production) - 使用 S3/OSS
- [高级模式示例](./advanced) - 更多高级用法
