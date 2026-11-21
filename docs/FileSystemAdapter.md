# FileSystemAdapter - 本地存储适配器

## 概述

FileSystemAdapter 让 BucketDB 使用本地文件系统作为存储后端，适合开发、测试和单机应用。每个对象是 `basePath` 下的一个文件。

## 特性

- 每个文档一个 JSON 文件，可直接查看和编辑
- 写入先落临时文件再 `link()` / `rename()` 到位，读者不会读到写了一半的文件
- 不存在才创建（`insert`）基于 `link()`，跨进程有效
- ETag 乐观锁（`update` 带 `etag`），仅在单进程内有效
- 目录在第一次写入时自动创建

## 使用方法

### 基本用法

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';

// 创建本地文件系统适配器
const adapter = new FileSystemAdapter({
  basePath: './my-database', // 数据库文件存储路径
});

// 创建数据库实例
const db = new BucketDB(adapter, 'my-app');

// 使用集合
const users = db.collection<User>('users');
await users.insert({ name: 'Alice', age: 25 });
```

### 文件系统结构

```
my-database/
  my-app/                    # dbPath
    users/                   # 集合名
      docs/
        {uuid}.json          # 每个文档一个文件
```

写入过程中会短暂出现 `{uuid}.json.<uuid>.tmp` 临时文件。临时文件、以 `.` 开头的文件（如 `.DS_Store`）以及 0.3 留下的 `*.meta` 文件都不会被当作文档。0.4 只读取 `docs/`，0.3 在集合目录下留下的索引和日志目录不再使用，可以删除。

### 文档示例

**docs/abc-123.json**：

```json
{
  "name": "Alice",
  "age": 25,
  "email": "alice@example.com",
  "status": "active",
  "id": "abc-123",
  "_createdAt": "2026-02-08T00:00:00.000Z",
  "_updatedAt": "2026-02-08T00:00:00.000Z"
}
```

`_etag` 不写入文件。读取时 `id` 取自文件名，`_etag` 由文件元信息计算，与文件内容无关。手工放到 `docs/<id>.json` 的 JSON 对象文件也会被当作文档读出；`docs/` 下不是 `<id>.json` 或内容不是 JSON 对象的文件会让 `find` 抛出 `StorageError`，`error.key` 指出是哪个文件。

## 配置选项

```typescript
interface FileSystemAdapterConfig {
  basePath: string; // 所有对象的根目录，第一次写入时创建
}
```

## ETag

ETag 由文件的 inode、修改时间（纳秒）和大小组成。每次写入都会生成新文件再替换，所以每次写入后 ETag 都会变化，即使内容相同。

## 并发

| 操作 | 多个进程同时写 |
|---|---|
| `insert` | 安全：`link()` 在目标已存在时失败，跨进程有效 |
| `delete` | 安全 |
| `update` 带 `etag` | 只在同一进程内保证；不同进程之间的冲突检测不到 |
| `update` 不带 `etag` | 同一进程内的并发更新会合并（冲突时自动重试）；不同进程之间后写覆盖 |

已测试：4 个进程各插入 25 个文档，100 个文档全部可见。

## 性能特点

### 优势

- 无网络调用
- 数据持久化，重启后保留
- 易于调试和检查数据

### 限制

- 单机存储，不支持多机共享
- 每次 `find` 都会读取集合里的全部文件（`{ id: '...' }` 查询除外）
- 条件更新（`etag`）只在单进程内有效
- 大量文档会产生大量文件，注意文件系统限制

## 适用场景

- ✅ **开发环境** - 快速原型开发
- ✅ **测试环境** - 集成测试
- ✅ **单机应用** - 桌面应用、CLI 工具、本机服务
- ✅ **小型项目** - 个人项目、演示应用
- ❌ **多机共享数据** - 使用 S3Adapter 或 OSSAdapter
- ❌ **多进程并发更新同一文档并依赖 `etag`** - 使用 S3Adapter

## 示例：数据持久化

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';

const adapter = new FileSystemAdapter({ basePath: './data' });
const db = new BucketDB(adapter, 'myapp');
const users = db.collection<User>('users');

// 第一次运行：插入数据
await users.insert({ name: 'Alice', age: 25 });

// 程序重启后：数据仍然存在
const allUsers = await users.find({});
console.log(allUsers.length); // 1
```

## 与其他适配器对比

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| 持久化 | 否 | 是 | 是 | 是 |
| 多机访问 | 否 | 否 | 是 | 是 |
| 单次写入原子 | 是 | 是 | 是 | 是 |
| 不存在才创建（`insert`） | 是 | 是（跨进程） | 是 | 是（仅限未开启版本控制的 bucket） |
| 条件更新（`etag`） | 是 | 仅单进程 | 是 | 否，抛 `UnsupportedError` |
| 并发局部更新全部生效 | 是 | 仅单进程 | 是 | 否（后写覆盖） |

## 清理数据

```typescript
import { rmSync } from 'node:fs';

// 删除整个数据库
rmSync('./my-database', { recursive: true, force: true });
```

## 注意事项

1. **权限**：`basePath` 会自动创建，确保应用有写入权限
2. **命名**：集合名、文档 ID 和 `dbPath` 的每一段只能包含字母、数字、`_`、`-`、`.`，长度 1-255，不能以 `.` 开头，否则抛 `ValidationError`
3. **备份**：定期备份 `basePath` 目录；直接复制 `docs/` 下的文件即可
