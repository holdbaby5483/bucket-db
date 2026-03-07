# FileSystemAdapter - 本地存储适配器

## 概述

FileSystemAdapter 允许 BucketDB 使用本地文件系统作为存储后端，非常适合开发、测试和单机应用场景。

## 特性

✅ 完整的 StorageAdapter 接口实现
✅ 支持 ETag 优化锁定
✅ 条件写入（ifMatch, ifNoneMatch）
✅ 批量读取优化
✅ 自动创建目录结构
✅ JSON 格式存储，易于调试
✅ 元数据文件支持

## 使用方法

### 基本用法

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db-core';

// 创建本地文件系统适配器
const adapter = new FileSystemAdapter({
  basePath: './my-database',  // 数据库文件存储路径
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
    users/                   # collection name
      docs/                  # 文档存储
        {uuid}.json          # 文档数据
        {uuid}.json.meta     # 元数据 (ETag)
      index/                 # 索引分片
        shard-00.json        # 分片数据
        shard-00.json.meta   # 分片元数据
        shard-01.json
        shard-01.json.meta
        ...
```

### 文档示例

**docs/abc-123.json** (文档数据):
```json
{
  "name": "Alice",
  "age": 25,
  "email": "alice@example.com",
  "status": "active",
  "id": "abc-123",
  "_createdAt": "2026-02-08T00:00:00.000Z",
  "_updatedAt": "2026-02-08T00:00:00.000Z",
  "_etag": "598bfa8554c23c357084f2728ea07db6"
}
```

**docs/abc-123.json.meta** (元数据):
```json
{
  "etag": "598bfa8554c23c357084f2728ea07db6",
  "data": { ... }
}
```

## 配置选项

```typescript
interface FileSystemAdapterConfig {
  basePath: string;  // 数据库文件的根目录路径
}
```

## ETag 生成

FileSystemAdapter 使用 MD5 哈希来生成 ETag：
- 基于文档内容的 JSON 字符串
- 确保内容相同时 ETag 相同
- 用于乐观锁定和并发控制

## 性能特点

### 优势
- 无需网络调用，速度快
- 适合开发和测试环境
- 数据持久化，重启后保留
- 易于调试和检查数据

### 限制
- 单机存储，不支持分布式
- 文件 I/O 可能成为瓶颈
- 不适合高并发场景
- 需要足够的磁盘空间

## 适用场景

✅ **开发环境** - 快速原型开发
✅ **测试环境** - 集成测试
✅ **单机应用** - 桌面应用、CLI 工具
✅ **小型项目** - 个人项目、演示应用
❌ **生产环境** - 建议使用 S3Adapter 或 OSSAdapter
❌ **高并发** - 使用云存储适配器

## 示例：数据持久化

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db-core';

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

| 特性 | FileSystem | Memory | S3 | OSS |
|------|-----------|--------|-----|-----|
| 持久化 | ✅ | ❌ | ✅ | ✅ |
| 速度 | 快 | 最快 | 中 | 中 |
| 分布式 | ❌ | ❌ | ✅ | ✅ |
| 成本 | 免费 | 免费 | 付费 | 付费 |
| 适用场景 | 开发/测试 | 测试 | 生产 | 生产 |

## 清理数据

```typescript
import { rmSync } from 'fs';

// 删除整个数据库
rmSync('./my-database', { recursive: true, force: true });
```

## 注意事项

1. **路径安全**：basePath 会自动创建，确保有写入权限
2. **并发控制**：通过 ETag 实现乐观锁定
3. **文件数量**：大量文档会创建大量文件，注意文件系统限制
4. **备份**：定期备份 basePath 目录
5. **权限**：确保应用有足够的文件系统权限

## 测试

所有 10 个单元测试通过：
- ✅ 基本读写操作
- ✅ ETag 验证
- ✅ 条件写入
- ✅ 批量操作
- ✅ 前缀查询
- ✅ 嵌套路径支持
