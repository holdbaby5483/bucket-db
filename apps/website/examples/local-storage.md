# 本地存储示例

使用 FileSystemAdapter 进行本地持久化存储。

## 完整代码

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface Todo extends Document {
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
}

async function main() {
  // 创建 FileSystemAdapter
  const adapter = new FileSystemAdapter({
    basePath: './local-db-data'
  });

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
  console.log('数据目录:', adapter.config.basePath);
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

运行后会生成以下目录结构：

```
local-db-data/
└── todo-app/
    └── todos/
        ├── docs/
        │   ├── a1b2c3d4-...-uuid.json
        │   ├── e5f6g7h8-...-uuid.json
        │   └── i9j0k1l2-...-uuid.json
        └── index/
            ├── shard-00.json
            ├── shard-01.json
            └── ...
```

## 文件内容示例

### 文档文件（docs/a1b2c3d4-...-uuid.json）

```json
{
  "id": "a1b2c3d4-e5f6-4g7h-8i9j-0k1l2m3n4o5p",
  "title": "学习 BucketDB",
  "completed": true,
  "priority": "high",
  "_etag": "etag-123-1709193600000",
  "_createdAt": "2026-02-28T10:00:00.000Z",
  "_updatedAt": "2026-02-28T10:05:00.000Z"
}
```

### 索引分片文件（index/shard-00.json）

```json
{
  "shardId": "00",
  "documents": {
    "a1b2c3d4-e5f6-4g7h-8i9j-0k1l2m3n4o5p": {
      "id": "a1b2c3d4-e5f6-4g7h-8i9j-0k1l2m3n4o5p",
      "title": "学习 BucketDB",
      "completed": true,
      "priority": "high",
      "_etag": "etag-123-1709193600000",
      "_updatedAt": "2026-02-28T10:05:00.000Z"
    }
  }
}
```

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
await db1.collection<Todo>('todos').insert({ title: 'Task 1', ... });

// 重启程序后
const db2 = new BucketDB(adapter, 'todo-app');
const todos = await db2.collection<Todo>('todos').find({});
// todos 包含之前插入的数据
```

### 3. .gitignore 配置

建议忽略本地数据库文件：

```gitignore
# .gitignore
local-db-data/
*.local.json
```

### 4. 多环境配置

```typescript
const basePath = process.env.NODE_ENV === 'production'
  ? '/var/lib/myapp/data'
  : './local-db-data';

const adapter = new FileSystemAdapter({ basePath });
```

## 适用场景

- ✅ 本地开发和测试
- ✅ 桌面应用
- ✅ 小规模服务器部署（单机）
- ✅ Serverless Edge Functions（读取操作）
- ❌ 多服务器集群（需要共享存储，使用 S3/OSS）

## 下一步

- [生产部署示例](./production) - 使用 S3/OSS
- [高级模式示例](./advanced) - 更多高级用法
