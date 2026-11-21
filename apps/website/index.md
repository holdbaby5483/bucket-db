---
layout: home

hero:
  name: BucketDB
  text: 云存储即数据库
  tagline: 基于 S3/OSS 的 TypeScript 文档数据库,无需服务器,零运行时依赖
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/
    - theme: alt
      text: 从 0.3 升级
      link: /guide/migration
    - theme: alt
      text: 查看 GitHub
      link: https://github.com/holdbaby5483/bucket-db
    - theme: alt
      text: npm 包
      link: https://www.npmjs.com/package/@hold-baby/bucket-db

features:
  - icon: 🚀
    title: 无服务器架构
    details: 使用云对象存储作为后端,无需维护数据库服务器,按用量计费
  - icon: 📄
    title: 一个文档一个对象
    details: 每个文档存为 <dbPath>/<collection>/docs/<id>.json,没有索引文件,也没有日志文件
  - icon: 📦
    title: 零运行时依赖
    details: 内置 S3 客户端(基于 Web Crypto 的 SigV4 签名),不依赖任何云厂商 SDK
  - icon: ☁️
    title: 多种存储后端
    details: 统一 API 支持 AWS S3(及 S3 兼容服务)、阿里云 OSS、本地文件系统和内存
  - icon: 🛡️
    title: 类型安全
    details: 完整的 TypeScript 类型推断,插入和更新类型自动排除系统字段
  - icon: 🔍
    title: 灵活查询
    details: 8 种查询操作符,支持条件组合和分页
  - icon: 🔒
    title: 乐观锁
    details: update 支持基于 ETag 的冲突检测,S3 与 Memory 上为原子条件写入,FileSystem 上限单进程
  - icon: 🎯
    title: 多租户隔离
    details: 通过 dbPath 参数实现多环境、多租户的数据隔离
---

::: warning 0.4.0-beta.0
当前版本为 beta,在 0.4.0 正式版之前 API 仍可能调整。从 0.3.x 升级请先阅读[升级指南](/guide/migration)。
:::

## 快速示例

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  age: number;
  email: string;
}

// 创建数据库实例
const db = new BucketDB(
  new FileSystemAdapter({ basePath: './data' }),
  'my-app'
);

// 获取集合
const users = db.collection<User>('users');

// 插入文档
const user = await users.insert({
  name: 'Alice',
  age: 25,
  email: 'alice@example.com'
});

// 查询文档
const adults = await users.find({ age: { $gte: 18 } });

// 更新文档
await users.update(user.id, { age: 26 });

// 删除文档
await users.delete(user.id);
```

## 为什么选择 BucketDB?

### 🎯 适用场景

- **小型集合** - 每个集合数千个文档以内,每秒少量写入
- **云原生** - 已使用云对象存储,希望简化架构、不运维数据库
- **类型安全** - TypeScript 项目,需要完整类型支持

### ⚠️ 当前限制(0.4.0-beta.0)

- **没有事务** - 每次写入只涉及一个文档。
- **`find` 读取整个集合** - 除 `{ id }` 查询外,每次 `find` 都会列出并读取集合中的每个文档。目前没有基准测试,不承诺容量数字。
- **OSS 不支持条件更新** - 带 `etag` 的 `update` 抛出 `UnsupportedError`;不带 `etag` 的并发更新后写覆盖。
- **FileSystem 的条件更新仅在单进程内有效**。
- **0.3.x 与 0.4 不能同时写入同一集合**。
- **beta** - 暂无 `sort`、`count`、自定义 ID。

各存储后端的保证详见[核心概念 - 保证与限制](/guide/concepts#保证与限制)。

### ⚡ 核心优势

**vs 传统数据库**
- 无需运维数据库服务器 - 数据直接存放在对象存储中
- 成本优化 - 按实际存储和请求付费,无最低消费
- 可用性与持久性 - 由底层云对象存储提供

**vs 其他文档数据库**
- 类型安全 - 完整 TypeScript 支持和类型推断
- 多云统一 - 一套代码支持多个存储后端
- 零依赖、零部署 - 无需容器、无需额外 SDK

## 开始使用

```bash
# 安装
bun add @hold-baby/bucket-db@next

# 或使用 npm
npm install @hold-baby/bucket-db@next
```

立即查看[快速开始指南](/guide/),5 分钟完成第一个应用。
