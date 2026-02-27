---
layout: home

hero:
  name: BucketDB
  text: 云存储即数据库
  tagline: 基于 S3/OSS 的 TypeScript 文档数据库,无需服务器
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/
    - theme: alt
      text: 查看 GitHub
      link: https://github.com/hold-baby/bucket-db

features:
  - icon: 🚀
    title: 无服务器架构
    details: 使用云对象存储作为后端,无需维护数据库服务器,按用量计费
  - icon: 📦
    title: 类型安全
    details: 完整的 TypeScript 类型推断和严格模式,开发时即发现错误
  - icon: ☁️
    title: 多云支持
    details: 统一 API 支持 AWS S3、阿里云 OSS 和本地文件系统
  - icon: 🔍
    title: 灵活查询
    details: 8 种查询操作符,支持复杂条件组合和分页查询
  - icon: 🔒
    title: 并发安全
    details: 基于 ETag 的乐观锁机制,保证并发更新的数据一致性
  - icon: 📊
    title: 可扩展索引
    details: 分片索引设计,轻松支持数十万文档的高效查询
  - icon: 🎯
    title: 多租户隔离
    details: 通过 dbPath 参数实现多环境、多租户的数据完全隔离
  - icon: ✅
    title: 测试完善
    details: 132 个自动化测试确保代码质量,覆盖所有核心功能
---

## 快速示例

```typescript
import { BucketDB, FileSystemAdapter } from '@bucket-db/core';
import type { Document } from '@bucket-db/core';

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

- **中小规模应用** - 文档数量在百万级以下
- **读多写少** - 查询频繁但写入不密集
- **云原生** - 已使用云服务,希望简化架构
- **类型安全** - TypeScript 项目,需要完整类型支持

### ⚡ 核心优势

**vs 传统数据库**
- 无需运维 - 不用管理服务器、备份、扩容
- 成本优化 - 按实际存储和请求付费,无最低消费
- 高可用 - 继承云存储的 99.99% 可用性

**vs 其他文档数据库**
- 类型安全 - 完整 TypeScript 支持和类型推断
- 多云统一 - 一套代码支持多个云平台
- 零部署 - 无需容器、无需配置、无需维护

## 开始使用

```bash
# 安装
bun add @bucket-db/core

# 或使用 npm
npm install @bucket-db/core
```

立即查看[快速开始指南](/guide/),5 分钟完成第一个应用。
