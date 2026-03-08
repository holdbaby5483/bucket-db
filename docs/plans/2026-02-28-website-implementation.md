# BucketDB 官网实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 创建 BucketDB 官方网站，包含营销首页、完整 API 文档和使用示例，基于 VitePress 构建。

**Architecture:** 独立官网项目位于 `apps/website/`，使用 VitePress 静态站点生成器。API 文档从 `docs/API.md` 同步到官网，指南和示例内容独立编写。

**Tech Stack:** VitePress 1.0+, Vue 3, TypeScript, Bun

---

## Task 1: 项目初始化

**Files:**
- Create: `apps/website/package.json`
- Create: `apps/website/tsconfig.json`
- Create: `apps/website/.gitignore`

**Step 1: 创建 apps 目录**

Run: `mkdir -p apps`
Expected: 目录创建成功

**Step 2: 创建 website 项目目录结构**

Run: `mkdir -p apps/website/{.vitepress,public,scripts,guide,api,examples}`
Expected: 所有目录创建成功

**Step 3: 创建 package.json**

Create: `apps/website/package.json`

```json
{
  "name": "@bucket-db/website",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev",
    "build": "bun run sync && vitepress build",
    "preview": "vitepress preview",
    "sync": "bun run scripts/sync-api-docs.ts"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "vitepress": "^1.0.0",
    "vue": "^3.4.0"
  }
}
```

**Step 4: 创建 tsconfig.json**

Create: `apps/website/tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": [
    ".vitepress/**/*",
    "scripts/**/*"
  ]
}
```

**Step 5: 创建 .gitignore**

Create: `apps/website/.gitignore`

```
.vitepress/cache
.vitepress/dist
node_modules
```

**Step 6: 安装依赖**

Run: `cd apps/website && bun install`
Expected: 依赖安装成功

**Step 7: 提交**

```bash
git add apps/website/
git commit -m "chore: initialize website project structure"
```

---

## Task 2: VitePress 配置

**Files:**
- Create: `apps/website/.vitepress/config.ts`

**Step 1: 创建 VitePress 配置文件**

Create: `apps/website/.vitepress/config.ts`

```typescript
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'BucketDB',
  description: 'TypeScript document database built on cloud object storage',

  base: '/',

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '指南', link: '/guide/' },
      { text: 'API', link: '/api/' },
      { text: '示例', link: '/examples/' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'GitHub', link: 'https://github.com/[username]/bucket-db' },
          { text: 'Changelog', link: 'https://github.com/[username]/bucket-db/releases' },
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/guide/' },
            { text: '安装指南', link: '/guide/installation' },
          ]
        },
        {
          text: '核心概念',
          items: [
            { text: '概念介绍', link: '/guide/concepts' },
            { text: '查询语法', link: '/guide/queries' },
            { text: '错误处理', link: '/guide/error-handling' }
          ]
        }
      ],

      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: '概览', link: '/api/' },
            { text: 'BucketDB', link: '/api/bucketdb' },
            { text: 'Collection', link: '/api/collection' },
            { text: '存储适配器', link: '/api/adapters' },
            { text: '类型定义', link: '/api/types' },
            { text: '错误类', link: '/api/errors' }
          ]
        }
      ],

      '/examples/': [
        {
          text: '示例',
          items: [
            { text: '示例索引', link: '/examples/' },
            { text: '基础用法', link: '/examples/basic-usage' },
            { text: '本地存储', link: '/examples/local-storage' },
            { text: '生产部署', link: '/examples/production' },
            { text: '高级模式', link: '/examples/advanced' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/[username]/bucket-db' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present'
    },

    editLink: {
      pattern: 'https://github.com/[username]/bucket-db/edit/main/apps/website/:path',
      text: '在 GitHub 上编辑此页'
    },

    search: {
      provider: 'local'
    }
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true
  }
});
```

**Step 2: 测试配置**

Run: `cd apps/website && bun run dev`
Expected: 开发服务器启动（Ctrl+C 停止）

**Step 3: 提交**

```bash
git add apps/website/.vitepress/config.ts
git commit -m "feat: add VitePress configuration"
```

---

## Task 3: 首页内容

**Files:**
- Create: `apps/website/index.md`
- Create: `apps/website/public/logo.svg`

**Step 1: 创建简单的 logo（临时）**

Create: `apps/website/public/logo.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="#42b883"/>
  <text x="50" y="60" font-size="40" text-anchor="middle" fill="white" font-family="Arial">DB</text>
</svg>
```

**Step 2: 创建首页内容**

Create: `apps/website/index.md`

```markdown
---
layout: home

hero:
  name: BucketDB
  text: 云存储即数据库
  tagline: 基于 S3/OSS 的 TypeScript 文档数据库，无需服务器
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/
    - theme: alt
      text: 查看 GitHub
      link: https://github.com/[username]/bucket-db

features:
  - icon: 🚀
    title: 无服务器架构
    details: 使用云对象存储作为后端，无需维护数据库服务器，按用量计费
  - icon: 📦
    title: 类型安全
    details: 完整的 TypeScript 类型推断和严格模式，开发时即发现错误
  - icon: ☁️
    title: 多云支持
    details: 统一 API 支持 AWS S3、阿里云 OSS 和本地文件系统
  - icon: 🔍
    title: 灵活查询
    details: 8 种查询操作符，支持复杂条件组合和分页查询
  - icon: 🔒
    title: 并发安全
    details: 基于 ETag 的乐观锁机制，保证并发更新的数据一致性
  - icon: 📊
    title: 可扩展索引
    details: 分片索引设计，轻松支持数十万文档的高效查询
  - icon: 🎯
    title: 多租户隔离
    details: 通过 dbPath 参数实现多环境、多租户的数据完全隔离
  - icon: ✅
    title: 测试完善
    details: 132 个自动化测试确保代码质量，覆盖所有核心功能
---

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

## 为什么选择 BucketDB？

### 🎯 适用场景

- **中小规模应用** - 文档数量在百万级以下
- **读多写少** - 查询频繁但写入不密集
- **云原生** - 已使用云服务，希望简化架构
- **类型安全** - TypeScript 项目，需要完整类型支持

### ⚡ 核心优势

**vs 传统数据库**
- 无需运维 - 不用管理服务器、备份、扩容
- 成本优化 - 按实际存储和请求付费，无最低消费
- 高可用 - 继承云存储的 99.99% 可用性

**vs 其他文档数据库**
- 类型安全 - 完整 TypeScript 支持和类型推断
- 多云统一 - 一套代码支持多个云平台
- 零部署 - 无需容器、无需配置、无需维护

## 开始使用

```bash
# 安装
bun add @hold-baby/bucket-db

# 或使用 npm
npm install @hold-baby/bucket-db
```

立即查看[快速开始指南](/guide/)，5 分钟完成第一个应用。
```

**Step 3: 测试首页**

Run: `cd apps/website && bun run dev`
Expected: 访问 http://localhost:5173 看到首页内容

**Step 4: 提交**

```bash
git add apps/website/index.md apps/website/public/
git commit -m "feat: add website homepage content"
```

---

## Task 4: 指南页面 - 快速开始

**Files:**
- Create: `apps/website/guide/index.md`
- Create: `apps/website/guide/installation.md`

**Step 1: 创建快速开始页面**

Create: `apps/website/guide/index.md`

```markdown
# 快速开始

5 分钟学会使用 BucketDB 进行文档存储和查询。

## 安装

```bash
bun add @hold-baby/bucket-db
```

详见[安装指南](./installation)了解更多安装方式。

## 第一个应用

### 1. 定义文档类型

```typescript
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}
```

所有文档都必须继承 `Document` 接口，它包含系统字段：
- `id` - 自动生成的唯一标识
- `_etag` - ETag 用于乐观锁
- `_createdAt` - 创建时间
- `_updatedAt` - 最后更新时间

### 2. 创建数据库实例

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';

const db = new BucketDB(
  new FileSystemAdapter({ basePath: './my-database' }),
  'my-app'
);
```

参数说明：
- **第一个参数** - 存储适配器（这里使用本地文件系统）
- **第二个参数** - 数据库路径（用于隔离不同环境/租户）

### 3. 获取集合

```typescript
const users = db.collection<User>('users');
```

集合类似于传统数据库的表，用于组织同类文档。

### 4. 插入文档

```typescript
const alice = await users.insert({
  name: 'Alice',
  age: 25,
  email: 'alice@example.com',
  status: 'active'
});

console.log(alice);
// {
//   id: 'a1b2c3d4-...',
//   name: 'Alice',
//   age: 25,
//   email: 'alice@example.com',
//   status: 'active',
//   _etag: 'etag-...',
//   _createdAt: '2026-02-28T10:00:00.000Z',
//   _updatedAt: '2026-02-28T10:00:00.000Z'
// }
```

系统字段会自动添加到返回的文档中。

### 5. 查询文档

```typescript
// 按 ID 查找
const user = await users.findById(alice.id);

// 等值查询
const activeUsers = await users.find({ status: 'active' });

// 比较查询
const adults = await users.find({ age: { $gte: 18 } });

// 组合查询
const results = await users.find({
  status: 'active',
  age: { $gte: 18, $lt: 65 }
});

// 分页查询
const page1 = await users.find({}, { limit: 10, offset: 0 });
const page2 = await users.find({}, { limit: 10, offset: 10 });
```

详见[查询语法](./queries)了解所有操作符。

### 6. 更新文档

```typescript
// 简单更新
const updated = await users.update(alice.id, {
  age: 26
});

// 使用乐观锁
const updated = await users.update(
  alice.id,
  { age: 26 },
  { etag: alice._etag }
);
```

更新操作是部分更新，只修改指定的字段。

### 7. 删除文档

```typescript
await users.delete(alice.id);
```

## 完整示例

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

async function main() {
  // 1. 创建数据库
  const db = new BucketDB(
    new FileSystemAdapter({ basePath: './my-database' }),
    'my-app'
  );

  // 2. 获取集合
  const users = db.collection<User>('users');

  // 3. 插入文档
  const alice = await users.insert({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com',
    status: 'active'
  });

  const bob = await users.insert({
    name: 'Bob',
    age: 30,
    email: 'bob@example.com',
    status: 'active'
  });

  // 4. 查询文档
  const activeUsers = await users.find({ status: 'active' });
  console.log(`Active users: ${activeUsers.length}`);

  const adults = await users.find({ age: { $gte: 25 } });
  console.log(`Adults (25+): ${adults.length}`);

  // 5. 更新文档
  await users.update(alice.id, { age: 26 });
  console.log('Updated Alice');

  // 6. 删除文档
  await users.delete(bob.id);
  console.log('Deleted Bob');

  // 7. 最终查询
  const finalUsers = await users.find({});
  console.log(`Final user count: ${finalUsers.length}`);
}

main().catch(console.error);
```

## 下一步

- [安装指南](./installation) - 详细的安装和配置说明
- [核心概念](./concepts) - 理解数据库、集合、文档等概念
- [查询语法](./queries) - 所有查询操作符详解
- [API 参考](/api/) - 完整的 API 文档
```

**Step 2: 创建安装指南**

Create: `apps/website/guide/installation.md`

```markdown
# 安装指南

本指南介绍如何在项目中安装和配置 BucketDB。

## 环境要求

- **Node.js** 18+ 或 **Bun** 1.0+
- **TypeScript** 5.0+（推荐）

## 包管理器

### 使用 Bun（推荐）

```bash
bun add @hold-baby/bucket-db
```

### 使用 npm

```bash
npm install @hold-baby/bucket-db
```

### 使用 yarn

```bash
yarn add @hold-baby/bucket-db
```

### 使用 pnpm

```bash
pnpm add @hold-baby/bucket-db
```

## 依赖说明

BucketDB 核心包 (`@hold-baby/bucket-db`) 包含：
- 核心数据库引擎
- 所有类型定义
- MemoryStorageAdapter（内存存储）
- FileSystemAdapter（文件系统存储）
- S3Adapter（AWS S3 存储）
- OSSAdapter（阿里云 OSS 存储）

### 可选依赖

如果使用云存储适配器，相应的 SDK 会自动安装：
- **S3Adapter** - `@aws-sdk/client-s3`（自动安装）
- **OSSAdapter** - `ali-oss`（自动安装）

## TypeScript 配置

确保 `tsconfig.json` 包含以下配置：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## 验证安装

创建 `test.ts` 文件：

```typescript
import { BucketDB, MemoryStorageAdapter } from '@hold-baby/bucket-db';

const db = new BucketDB(new MemoryStorageAdapter(), 'test');
console.log('BucketDB installed successfully!');
```

运行：

```bash
bun run test.ts
# 或
node --loader ts-node/esm test.ts
```

如果看到 "BucketDB installed successfully!"，说明安装成功。

## 下一步

- [快速开始](./index) - 5 分钟上手教程
- [核心概念](./concepts) - 理解 BucketDB 的核心概念
- [存储适配器](/api/adapters) - 选择合适的存储后端
```

**Step 3: 测试指南页面**

Run: `cd apps/website && bun run dev`
Expected: 访问 http://localhost:5173/guide/ 看到快速开始页面

**Step 4: 提交**

```bash
git add apps/website/guide/
git commit -m "feat: add quick start and installation guides"
```

---

## Task 5: 指南页面 - 核心概念

**Files:**
- Create: `apps/website/guide/concepts.md`
- Create: `apps/website/guide/queries.md`
- Create: `apps/website/guide/error-handling.md`

**Step 1: 创建核心概念页面**

Create: `apps/website/guide/concepts.md`

```markdown
# 核心概念

理解 BucketDB 的核心概念，帮助你更好地使用它。

## 数据库（BucketDB）

数据库是顶层容器，通过 `dbPath` 参数实现数据隔离。

```typescript
const db = new BucketDB(adapter, 'my-app');
```

**用途**：
- **多环境隔离** - 开发、测试、生产环境使用不同的 dbPath
- **多租户隔离** - 每个租户使用独立的 dbPath
- **逻辑分组** - 按业务逻辑分组数据

**示例**：

```typescript
// 多环境
const devDB = new BucketDB(adapter, 'dev');
const prodDB = new BucketDB(adapter, 'prod');

// 多租户
const tenant1DB = new BucketDB(adapter, 'tenant-001');
const tenant2DB = new BucketDB(adapter, 'tenant-002');
```

## 集合（Collection）

集合是文档的容器，类似于传统数据库的表。

```typescript
const users = db.collection<User>('users');
```

**特性**：
- **类型安全** - 泛型参数提供完整的类型推断
- **独立索引** - 每个集合有自己的索引分片
- **单例模式** - 同一 dbPath 下同名集合返回同一实例

**配置**：

```typescript
const users = db.collection<User>('users', {
  shardCount: 32  // 自定义分片数量（默认 16）
});
```

## 文档（Document）

文档是数据的基本单元，包含用户数据和系统字段。

```typescript
interface User extends Document {
  name: string;
  age: number;
  email: string;
}
```

**系统字段**：
- `id: string` - 唯一标识符（UUID v4）
- `_etag?: string` - ETag，用于乐观锁
- `_createdAt?: string` - 创建时间（ISO 8601）
- `_updatedAt?: string` - 更新时间（ISO 8601）

**类型变换**：

```typescript
// 插入时：省略系统字段
type InsertDocument<T> = Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>;

// 更新时：所有字段可选，除了 id
type UpdateDocument<T> = Partial<Omit<T, 'id'>>;
```

## 存储适配器（StorageAdapter）

存储适配器是对底层存储的抽象，提供统一的 API。

**可用适配器**：

| 适配器 | 用途 | 性能 | 成本 |
|--------|------|------|------|
| MemoryStorageAdapter | 测试、开发 | 极快 | 免费 |
| FileSystemAdapter | 本地开发、小规模部署 | 快 | 免费 |
| S3Adapter | AWS 生产环境 | 中等 | 按用量 |
| OSSAdapter | 阿里云生产环境 | 中等 | 按用量 |

**选择建议**：
- **开发/测试** - FileSystemAdapter 或 MemoryStorageAdapter
- **生产环境** - S3Adapter 或 OSSAdapter（根据云平台）
- **小规模部署** - FileSystemAdapter（配合 VPS）

详见 [存储适配器 API](/api/adapters)。

## 索引分片（Index Sharding）

BucketDB 使用分片索引提升查询性能。

**工作原理**：
1. 根据文档 ID 的哈希值分配分片
2. 每个分片独立存储，减少单文件大小
3. 查询时并行扫描所有分片

**配置分片数量**：

```typescript
const users = db.collection<User>('users', {
  shardCount: 32  // 默认 16
});
```

**选择策略**：
- **< 10K 文档** - 4-8 个分片
- **10K-100K 文档** - 16-32 个分片
- **> 100K 文档** - 32-64 个分片

**注意**：分片数量创建后不可修改。

## 乐观锁（Optimistic Locking）

基于 ETag 的乐观锁机制，防止并发更新冲突。

**工作原理**：
1. 读取文档时获取 `_etag`
2. 更新时传入 `_etag`
3. 如果 ETag 不匹配，抛出 `ConcurrentUpdateError`

**使用示例**：

```typescript
const user = await users.findById('user-123');

try {
  await users.update('user-123', { age: 26 }, { etag: user._etag });
} catch (error) {
  if (error instanceof ConcurrentUpdateError) {
    console.log('并发更新冲突，请重试');
  }
}
```

**重试模式**：

```typescript
async function updateWithRetry(id: string, updates: Partial<User>) {
  let retries = 3;

  while (retries > 0) {
    const user = await users.findById(id);
    if (!user) throw new Error('User not found');

    try {
      return await users.update(id, updates, { etag: user._etag });
    } catch (error) {
      if (error instanceof ConcurrentUpdateError && retries > 1) {
        retries--;
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      throw error;
    }
  }
}
```

详见[错误处理](./error-handling)。

## 数据组织

BucketDB 在存储中的组织结构：

```
{dbPath}/
  {collectionName}/
    docs/
      {id}.json           # 文档文件
    index/
      shard-00.json       # 索引分片
      shard-01.json
      ...
```

**示例**：

```
my-app/
  users/
    docs/
      a1b2c3d4-...-uuid.json
      e5f6g7h8-...-uuid.json
    index/
      shard-00.json
      shard-01.json
      ...
      shard-15.json
```

## 下一步

- [查询语法](./queries) - 学习所有查询操作符
- [错误处理](./error-handling) - 处理常见错误场景
- [API 参考](/api/) - 完整的 API 文档
```

**Step 2: 创建查询语法页面**

Create: `apps/website/guide/queries.md`

```markdown
# 查询语法

BucketDB 提供 8 种查询操作符，支持灵活的文档查询。

## 基础查询

### 等值查询

最简单的查询方式，直接指定字段值：

```typescript
// 查找所有 status 为 'active' 的用户
const users = await collection.find({ status: 'active' });

// 多字段等值查询（AND 逻辑）
const users = await collection.find({
  status: 'active',
  role: 'admin'
});
```

等价于：

```typescript
const users = await collection.find({
  status: { $eq: 'active' },
  role: { $eq: 'admin' }
});
```

## 比较操作符

### $eq - 等于

```typescript
const users = await collection.find({ age: { $eq: 25 } });
```

### $ne - 不等于

```typescript
// 查找所有非删除状态的用户
const users = await collection.find({ status: { $ne: 'deleted' } });
```

### $gt - 大于

```typescript
// 查找年龄大于 18 的用户
const users = await collection.find({ age: { $gt: 18 } });
```

### $gte - 大于等于

```typescript
// 查找年龄 >= 18 的用户
const users = await collection.find({ age: { $gte: 18 } });
```

### $lt - 小于

```typescript
// 查找年龄小于 65 的用户
const users = await collection.find({ age: { $lt: 65 } });
```

### $lte - 小于等于

```typescript
// 查找年龄 <= 65 的用户
const users = await collection.find({ age: { $lte: 65 } });
```

## 数组操作符

### $in - 在数组中

```typescript
// 查找状态为 active 或 pending 的用户
const users = await collection.find({
  status: { $in: ['active', 'pending'] }
});
```

### $nin - 不在数组中

```typescript
// 查找状态不是 deleted 或 banned 的用户
const users = await collection.find({
  status: { $nin: ['deleted', 'banned'] }
});
```

## 组合查询

### 多个操作符（AND 逻辑）

同一字段可以使用多个操作符：

```typescript
// 查找年龄在 18-65 之间的用户
const users = await collection.find({
  age: { $gte: 18, $lt: 65 }
});
```

### 多个字段（AND 逻辑）

不同字段的条件会自动组合：

```typescript
// 查找活跃的成年用户
const users = await collection.find({
  status: 'active',
  age: { $gte: 18 }
});

// 复杂组合
const users = await collection.find({
  status: { $in: ['active', 'pending'] },
  age: { $gte: 18, $lt: 65 },
  role: { $ne: 'guest' }
});
```

## 分页查询

使用 `limit` 和 `offset` 实现分页：

```typescript
// 第一页：前 10 条
const page1 = await collection.find({}, { limit: 10, offset: 0 });

// 第二页：第 11-20 条
const page2 = await collection.find({}, { limit: 10, offset: 10 });

// 第三页：第 21-30 条
const page3 = await collection.find({}, { limit: 10, offset: 20 });
```

**分页辅助函数**：

```typescript
async function getPage(
  filter: QueryFilter<User>,
  page: number,
  pageSize: number = 10
) {
  return await collection.find(filter, {
    limit: pageSize,
    offset: (page - 1) * pageSize
  });
}

// 使用
const page1 = await getPage({ status: 'active' }, 1, 20);
const page2 = await getPage({ status: 'active' }, 2, 20);
```

**迭代器模式**：

```typescript
async function* paginateAll(
  filter: QueryFilter<User>,
  pageSize: number = 100
) {
  let offset = 0;

  while (true) {
    const page = await collection.find(filter, { limit: pageSize, offset });
    if (page.length === 0) break;

    yield page;
    offset += page.length;

    if (page.length < pageSize) break;  // 最后一页
  }
}

// 使用
for await (const page of paginateAll({ status: 'active' })) {
  console.log(`Processing ${page.length} users`);
  // 处理当前页
}
```

## 查询最佳实践

### 1. 使用具体的过滤条件

```typescript
// ✅ 好：具体的条件，减少扫描
const users = await collection.find({
  status: 'active',
  age: { $gte: 18 }
});

// ❌ 差：空过滤，扫描所有文档
const all = await collection.find({});
```

### 2. 选择性字段优先

优先使用选择性高的字段（值分布均匀的字段）：

```typescript
// ✅ 好：email 唯一性高
const user = await collection.find({ email: 'alice@example.com' });

// ⚠️ 差：status 值有限，选择性低
const users = await collection.find({ status: 'active' });
```

### 3. 合理使用分页

大结果集必须使用分页：

```typescript
// ✅ 好：分页获取
const page = await collection.find({}, { limit: 100, offset: 0 });

// ❌ 差：一次获取所有（可能数万条）
const all = await collection.find({});
```

### 4. 避免过度过滤

不必要的条件会降低性能：

```typescript
// ✅ 好：只用必要条件
const users = await collection.find({ id: 'user-123' });

// ❌ 差：id 已经唯一，其他条件多余
const users = await collection.find({
  id: 'user-123',
  status: 'active',  // 多余
  age: { $gte: 0 }   // 多余
});
```

## 性能提示

- **分片数量** - 根据文档数量选择合适的分片数（见[核心概念](./concepts#索引分片)）
- **批量查询** - 尽量减少查询次数，合理使用 `limit`
- **字段选择性** - 优先使用选择性高的字段查询
- **缓存结果** - 对频繁查询的结果进行应用层缓存

## 类型安全

TypeScript 会自动推断查询类型：

```typescript
interface User extends Document {
  name: string;
  age: number;
  status: 'active' | 'inactive';
}

const users = db.collection<User>('users');

// ✅ 类型安全：字段和值都会被检查
await users.find({ status: 'active' });

// ❌ 编译错误：字段不存在
await users.find({ foo: 'bar' });

// ❌ 编译错误：值类型不匹配
await users.find({ status: 'invalid' });

// ✅ 类型推断：操作符值类型正确
await users.find({ age: { $gte: 18 } });

// ❌ 编译错误：操作符值类型错误
await users.find({ age: { $gte: 'eighteen' } });
```

## 下一步

- [错误处理](./error-handling) - 处理查询错误
- [API 参考 - Collection](/api/collection) - 完整的 Collection API
- [示例 - 高级模式](/examples/advanced) - 复杂查询示例
```

**Step 3: 创建错误处理页面**

Create: `apps/website/guide/error-handling.md`

```markdown
# 错误处理

BucketDB 提供明确的错误类型，帮助你正确处理各种异常情况。

## 错误类型

所有 BucketDB 错误都继承自 `BucketDBError`：

```typescript
import {
  BucketDBError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError
} from '@hold-baby/bucket-db';
```

## DocumentNotFoundError

当尝试访问不存在的文档时抛出。

**触发场景**：
- `findById()` 返回 `null`（不抛出错误）
- `update()` 不存在的文档
- `delete()` 不存在的文档

**处理方式**：

```typescript
try {
  await users.update('non-existent-id', { age: 26 });
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log('用户不存在');
  }
}
```

**最佳实践**：

```typescript
// 更新前先检查
const user = await users.findById(id);
if (!user) {
  throw new Error('User not found');
}

await users.update(id, updates);
```

## ConcurrentUpdateError

并发更新冲突，ETag 不匹配时抛出。

**触发场景**：
- `update()` 时提供的 etag 与当前不匹配
- 两个并发更新同一文档

**处理方式 - 重试模式**：

```typescript
async function updateWithRetry(
  id: string,
  updates: Partial<User>,
  maxRetries: number = 3
): Promise<User> {
  let retries = maxRetries;

  while (retries > 0) {
    try {
      const user = await users.findById(id);
      if (!user) {
        throw new DocumentNotFoundError(id);
      }

      return await users.update(id, updates, { etag: user._etag });
    } catch (error) {
      if (error instanceof ConcurrentUpdateError && retries > 1) {
        retries--;
        // 指数退避
        await new Promise(resolve =>
          setTimeout(resolve, 100 * (maxRetries - retries + 1))
        );
        continue;
      }
      throw error;
    }
  }

  throw new Error('Update failed after retries');
}

// 使用
try {
  const updated = await updateWithRetry('user-123', { age: 26 });
  console.log('Updated successfully:', updated);
} catch (error) {
  console.error('Update failed:', error);
}
```

**处理方式 - 用户确认**：

```typescript
async function updateWithConfirmation(id: string, updates: Partial<User>) {
  const user = await users.findById(id);
  if (!user) throw new DocumentNotFoundError(id);

  try {
    return await users.update(id, updates, { etag: user._etag });
  } catch (error) {
    if (error instanceof ConcurrentUpdateError) {
      // 获取最新数据
      const latest = await users.findById(id);

      // 询问用户是否覆盖
      const confirmed = await askUserConfirmation(
        `数据已被修改，是否覆盖？`,
        { original: user, latest, updates }
      );

      if (confirmed) {
        // 强制更新（不使用 etag）
        return await users.update(id, updates);
      }
    }
    throw error;
  }
}
```

## ValidationError

数据验证失败时抛出（未来版本可能使用）。

```typescript
try {
  await users.insert({ name: '' });  // 假设 name 不能为空
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('验证失败:', error.message);
  }
}
```

## StorageError

底层存储操作失败时抛出。

**触发场景**：
- S3/OSS 连接失败
- 文件系统权限错误
- 网络超时

**处理方式**：

```typescript
try {
  const user = await users.findById('user-123');
} catch (error) {
  if (error instanceof StorageError) {
    console.error('存储错误:', error.message);
    console.error('原因:', error.cause);

    // 可能需要重试或降级
    return await fallbackHandler();
  }
}
```

## 通用错误处理

### 1. 统一错误处理器

```typescript
async function handleDBOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      console.error('文档不存在:', error.message);
      throw new AppError('DOCUMENT_NOT_FOUND', 404);
    }

    if (error instanceof ConcurrentUpdateError) {
      console.error('并发冲突:', error.message);
      throw new AppError('CONFLICT', 409);
    }

    if (error instanceof StorageError) {
      console.error('存储错误:', error.message);
      throw new AppError('STORAGE_ERROR', 500);
    }

    // 未知错误
    console.error('未知错误:', error);
    throw new AppError('INTERNAL_ERROR', 500);
  }
}

// 使用
const user = await handleDBOperation(() =>
  users.findById('user-123')
);
```

### 2. Express 中间件

```typescript
import { BucketDBError } from '@hold-baby/bucket-db';
import type { Request, Response, NextFunction } from 'express';

function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof DocumentNotFoundError) {
    return res.status(404).json({ error: 'Resource not found' });
  }

  if (err instanceof ConcurrentUpdateError) {
    return res.status(409).json({ error: 'Conflict, please retry' });
  }

  if (err instanceof BucketDBError) {
    return res.status(500).json({ error: 'Database error' });
  }

  // 其他错误
  next(err);
}

app.use(errorHandler);
```

### 3. 日志记录

```typescript
function logError(error: Error, context: Record<string, any>) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    context
  };

  if (error instanceof StorageError && error.cause) {
    logEntry.error.cause = {
      message: error.cause.message,
      stack: error.cause.stack
    };
  }

  console.error(JSON.stringify(logEntry));
}

// 使用
try {
  await users.update(id, updates);
} catch (error) {
  logError(error as Error, { operation: 'update', userId: id });
  throw error;
}
```

## 最佳实践

### 1. 始终处理错误

```typescript
// ✅ 好：捕获并处理
try {
  const user = await users.findById(id);
  if (!user) {
    return null;  // 或抛出自定义错误
  }
  return user;
} catch (error) {
  logger.error('Failed to fetch user', { error, userId: id });
  throw error;
}

// ❌ 差：不处理错误
const user = await users.findById(id);  // 可能抛出错误
```

### 2. 区分预期和非预期错误

```typescript
// 预期错误（业务逻辑）
const user = await users.findById(id);
if (!user) {
  return { error: 'User not found' };  // 正常处理
}

// 非预期错误（系统错误）
try {
  return await users.update(id, updates);
} catch (error) {
  // 记录并上报
  logger.error('Unexpected error', { error });
  throw error;
}
```

### 3. 提供有用的错误信息

```typescript
try {
  await users.update(id, updates);
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    throw new Error(`User ${id} not found`);
  }

  if (error instanceof ConcurrentUpdateError) {
    throw new Error(
      `User ${id} was modified by another request, please retry`
    );
  }

  throw error;
}
```

### 4. 使用类型守卫

```typescript
function isDocumentNotFound(error: unknown): error is DocumentNotFoundError {
  return error instanceof DocumentNotFoundError;
}

function isConcurrentUpdate(error: unknown): error is ConcurrentUpdateError {
  return error instanceof ConcurrentUpdateError;
}

// 使用
try {
  await users.update(id, updates);
} catch (error) {
  if (isDocumentNotFound(error)) {
    // TypeScript 知道这是 DocumentNotFoundError
    console.log(error.message);
  } else if (isConcurrentUpdate(error)) {
    // TypeScript 知道这是 ConcurrentUpdateError
    await retryUpdate();
  }
}
```

## 调试技巧

### 1. 启用详细日志

```typescript
import { BucketDB, StorageError } from '@hold-baby/bucket-db';

try {
  // 操作
} catch (error) {
  if (error instanceof StorageError) {
    console.log('Storage error details:');
    console.log('  Message:', error.message);
    console.log('  Cause:', error.cause);
    console.log('  Stack:', error.stack);
  }
}
```

### 2. 检查存储状态

```typescript
// FileSystemAdapter
const adapter = new FileSystemAdapter({ basePath: './data' });
// 检查文件：ls -R ./data

// S3Adapter
// 使用 AWS CLI: aws s3 ls s3://bucket/my-app/
```

### 3. 验证数据完整性

```typescript
async function validateCollection(collection: Collection<any>) {
  const allDocs = await collection.find({});

  for (const doc of allDocs) {
    if (!doc.id) {
      console.error('Missing id:', doc);
    }
    if (!doc._etag) {
      console.error('Missing etag:', doc);
    }
    if (!doc._createdAt || !doc._updatedAt) {
      console.error('Missing timestamps:', doc);
    }
  }
}
```

## 下一步

- [API 参考 - 错误类](/api/errors) - 完整的错误类 API
- [示例 - 高级模式](/examples/advanced) - 错误处理实例
```

**Step 4: 测试指南页面**

Run: `cd apps/website && bun run dev`
Expected: 访问所有指南页面，内容正确显示

**Step 5: 提交**

```bash
git add apps/website/guide/
git commit -m "feat: add concepts, queries, and error handling guides"
```

---

## Task 6: API 同步脚本

**Files:**
- Create: `apps/website/scripts/sync-api-docs.ts`

**Step 1: 创建同步脚本**

Create: `apps/website/scripts/sync-api-docs.ts`

```typescript
#!/usr/bin/env bun

/**
 * 从 docs/API.md 同步 API 文档到 apps/website/api/
 *
 * 将单个 API.md 文件按标题拆分为多个页面：
 * - BucketDB 类 → api/bucketdb.md
 * - Collection 类 → api/collection.md
 * - 存储适配器 → api/adapters.md
 * - 类型定义 → api/types.md
 * - 错误类 → api/errors.md
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 路径配置
const SOURCE_FILE = join(process.cwd(), '../../docs/API.md');
const TARGET_DIR = join(process.cwd(), 'api');

// 确保目标目录存在
if (!existsSync(TARGET_DIR)) {
  mkdirSync(TARGET_DIR, { recursive: true });
}

// 读取源文件
console.log(`Reading source: ${SOURCE_FILE}`);
const content = readFileSync(SOURCE_FILE, 'utf-8');

// 拆分章节
const sections = splitSections(content);

// 生成各个页面
generateIndexPage(sections);
generateBucketDBPage(sections);
generateCollectionPage(sections);
generateAdaptersPage(sections);
generateTypesPage(sections);
generateErrorsPage(sections);

console.log('✅ API 文档同步完成');

/**
 * 按二级标题拆分内容
 */
function splitSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');

  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    // 检测二级标题
    if (line.startsWith('## ')) {
      // 保存前一个章节
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n').trim());
      }

      // 开始新章节
      currentSection = line.replace('## ', '').trim();
      currentContent = [line];
    } else {
      currentContent.push(line);
    }
  }

  // 保存最后一个章节
  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n').trim());
  }

  return sections;
}

/**
 * 生成 API 概览页面
 */
function generateIndexPage(sections: Map<string, string>) {
  const content = `# API 参考

BucketDB 完整的 API 文档。

## 快速导航

- [BucketDB 类](./bucketdb) - 数据库主类
- [Collection 类](./collection) - 集合操作
- [存储适配器](./adapters) - 存储后端
- [类型定义](./types) - TypeScript 类型
- [错误类](./errors) - 错误处理

## 安装

\`\`\`bash
bun add @hold-baby/bucket-db
\`\`\`

## 基础用法

\`\`\`typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  email: string;
}

const db = new BucketDB(
  new FileSystemAdapter({ basePath: './data' }),
  'my-app'
);

const users = db.collection<User>('users');

await users.insert({ name: 'Alice', email: 'alice@example.com' });
const all = await users.find({});
\`\`\`

## 核心类

### BucketDB

主数据库类，管理集合和配置。

\`\`\`typescript
const db = new BucketDB(adapter, dbPath, options);
const collection = db.collection<T>(name, options);
\`\`\`

详见 [BucketDB API](./bucketdb)。

### Collection

集合类，提供 CRUD 操作。

\`\`\`typescript
await collection.insert(data);
await collection.findById(id);
await collection.find(filter, options);
await collection.update(id, data, options);
await collection.delete(id);
\`\`\`

详见 [Collection API](./collection)。

## 存储适配器

- **MemoryStorageAdapter** - 内存存储（测试）
- **FileSystemAdapter** - 文件系统（本地开发）
- **S3Adapter** - AWS S3（生产）
- **OSSAdapter** - 阿里云 OSS（生产）

详见 [存储适配器 API](./adapters)。

## 类型系统

BucketDB 提供完整的 TypeScript 类型：

- \`Document\` - 文档基础类型
- \`QueryFilter<T>\` - 查询过滤器
- \`InsertDocument<T>\` - 插入文档类型
- \`UpdateDocument<T>\` - 更新文档类型

详见 [类型定义](./types)。

## 错误处理

所有错误继承自 \`BucketDBError\`：

- \`DocumentNotFoundError\` - 文档不存在
- \`ConcurrentUpdateError\` - 并发更新冲突
- \`ValidationError\` - 验证失败
- \`StorageError\` - 存储错误

详见 [错误类 API](./errors)。
`;

  writeFileSync(join(TARGET_DIR, 'index.md'), content);
  console.log('  ✓ api/index.md');
}

/**
 * 生成 BucketDB 页面
 */
function generateBucketDBPage(sections: Map<string, string>) {
  const bucketdbSection = sections.get('Core Classes') || '';

  const content = `# BucketDB 类

主数据库类，管理集合和配置。

${extractSubsection(bucketdbSection, 'BucketDB')}
`;

  writeFileSync(join(TARGET_DIR, 'bucketdb.md'), content);
  console.log('  ✓ api/bucketdb.md');
}

/**
 * 生成 Collection 页面
 */
function generateCollectionPage(sections: Map<string, string>) {
  const coreSection = sections.get('Core Classes') || '';

  const content = `# Collection 类

集合类，提供类型安全的 CRUD 操作。

${extractSubsection(coreSection, 'Collection<T>')}
`;

  writeFileSync(join(TARGET_DIR, 'collection.md'), content);
  console.log('  ✓ api/collection.md');
}

/**
 * 生成适配器页面
 */
function generateAdaptersPage(sections: Map<string, string>) {
  const content = sections.get('Storage Adapters') || '';

  writeFileSync(join(TARGET_DIR, 'adapters.md'), content);
  console.log('  ✓ api/adapters.md');
}

/**
 * 生成类型页面
 */
function generateTypesPage(sections: Map<string, string>) {
  const content = sections.get('Type Definitions') || '';

  writeFileSync(join(TARGET_DIR, 'types.md'), content);
  console.log('  ✓ api/types.md');
}

/**
 * 生成错误类页面
 */
function generateErrorsPage(sections: Map<string, string>) {
  const content = sections.get('Error Classes') || '';

  writeFileSync(join(TARGET_DIR, 'errors.md'), content);
  console.log('  ✓ api/errors.md');
}

/**
 * 从章节中提取子章节
 */
function extractSubsection(section: string, title: string): string {
  const lines = section.split('\n');
  const result: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (line.startsWith(`### ${title}`)) {
      capturing = true;
      result.push(line);
      continue;
    }

    if (capturing) {
      // 遇到下一个三级标题，停止
      if (line.startsWith('### ') && !line.startsWith(`### ${title}`)) {
        break;
      }
      result.push(line);
    }
  }

  return result.join('\n').trim();
}
```

**Step 2: 测试同步脚本**

Run: `cd apps/website && bun run sync`
Expected: api/ 目录下生成多个 .md 文件

**Step 3: 验证生成的文件**

Run: `ls -la apps/website/api/`
Expected: 看到 index.md, bucketdb.md, collection.md 等文件

**Step 4: 提交**

```bash
git add apps/website/scripts/ apps/website/api/
git commit -m "feat: add API documentation sync script"
```

---

## Task 7: 示例页面

**Files:**
- Create: `apps/website/examples/index.md`
- Create: `apps/website/examples/basic-usage.md`
- Create: `apps/website/examples/local-storage.md`
- Create: `apps/website/examples/production.md`
- Create: `apps/website/examples/advanced.md`

**Step 1: 创建示例索引**

Create: `apps/website/examples/index.md`

```markdown
# 示例

通过实际示例学习 BucketDB 的各种用法。

## 基础示例

- [基础用法](./basic-usage) - 完整的 CRUD 操作示例
- [本地存储](./local-storage) - 使用 FileSystemAdapter 进行本地开发

## 生产部署

- [生产部署](./production) - S3 和 OSS 配置示例

## 高级用法

- [高级模式](./advanced) - 分页、乐观锁、多租户等高级特性

## 运行示例

所有示例代码都可以在项目的 `examples/` 目录中找到：

\`\`\`bash
# 克隆仓库
git clone https://github.com/[username]/bucket-db.git
cd bucket-db

# 安装依赖
bun install

# 运行基础示例
bun run examples/basic-usage/index.ts

# 运行本地存储示例
bun run examples/local-storage/index.ts

# 运行多数据库示例
bun run examples/dbpath-demo/index.ts
\`\`\`

## 下一步

- [快速开始](/guide/) - 5 分钟上手教程
- [API 参考](/api/) - 完整的 API 文档
```

**Step 2: 创建基础用法示例**

Create: `apps/website/examples/basic-usage.md`

```markdown
# 基础用法示例

完整的 CRUD 操作示例，展示 BucketDB 的基本功能。

## 完整代码

\`\`\`typescript
import { BucketDB, MemoryStorageAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

// 1. 定义文档类型
interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

async function main() {
  // 2. 创建数据库实例（使用内存存储）
  const db = new BucketDB(new MemoryStorageAdapter(), 'demo-app');

  // 3. 获取集合
  const users = db.collection<User>('users');

  console.log('=== 插入文档 ===');

  // 4. 插入文档
  const alice = await users.insert({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com',
    status: 'active'
  });
  console.log('Inserted Alice:', alice.id);

  const bob = await users.insert({
    name: 'Bob',
    age: 30,
    email: 'bob@example.com',
    status: 'active'
  });
  console.log('Inserted Bob:', bob.id);

  const charlie = await users.insert({
    name: 'Charlie',
    age: 35,
    email: 'charlie@example.com',
    status: 'inactive'
  });
  console.log('Inserted Charlie:', charlie.id);

  console.log('\n=== 按 ID 查找 ===');

  // 5. 按 ID 查找
  const foundAlice = await users.findById(alice.id);
  console.log('Found:', foundAlice?.name);

  console.log('\n=== 等值查询 ===');

  // 6. 等值查询
  const activeUsers = await users.find({ status: 'active' });
  console.log('Active users:', activeUsers.map(u => u.name));

  console.log('\n=== 比较查询 ===');

  // 7. 比较查询
  const adults = await users.find({ age: { $gte: 25 } });
  console.log('Adults (25+):', adults.map(u => u.name));

  console.log('\n=== 组合查询 ===');

  // 8. 组合查询
  const results = await users.find({
    status: 'active',
    age: { $gte: 25, $lt: 35 }
  });
  console.log('Active adults (25-34):', results.map(u => u.name));

  console.log('\n=== 分页查询 ===');

  // 9. 分页查询
  const page1 = await users.find({}, { limit: 2, offset: 0 });
  const page2 = await users.find({}, { limit: 2, offset: 2 });
  console.log('Page 1:', page1.map(u => u.name));
  console.log('Page 2:', page2.map(u => u.name));

  console.log('\n=== 更新文档 ===');

  // 10. 更新文档
  const updatedAlice = await users.update(alice.id, { age: 26 });
  console.log('Updated Alice age:', updatedAlice.age);

  console.log('\n=== 乐观锁更新 ===');

  // 11. 使用乐观锁更新
  const current = await users.findById(bob.id);
  if (current) {
    try {
      await users.update(
        bob.id,
        { age: 31 },
        { etag: current._etag }
      );
      console.log('Updated Bob with optimistic locking');
    } catch (error) {
      console.log('Concurrent update detected');
    }
  }

  console.log('\n=== 删除文档 ===');

  // 12. 删除文档
  await users.delete(charlie.id);
  console.log('Deleted Charlie');

  console.log('\n=== 最终统计 ===');

  // 13. 最终查询
  const allUsers = await users.find({});
  console.log('Total users:', allUsers.length);
  console.log('Remaining users:', allUsers.map(u => u.name));
}

main().catch(console.error);
\`\`\`

## 运行结果

\`\`\`
=== 插入文档 ===
Inserted Alice: a1b2c3d4-e5f6-...
Inserted Bob: f7g8h9i0-j1k2-...
Inserted Charlie: l3m4n5o6-p7q8-...

=== 按 ID 查找 ===
Found: Alice

=== 等值查询 ===
Active users: [ 'Alice', 'Bob' ]

=== 比较查询 ===
Adults (25+): [ 'Alice', 'Bob', 'Charlie' ]

=== 组合查询 ===
Active adults (25-34): [ 'Alice', 'Bob' ]

=== 分页查询 ===
Page 1: [ 'Alice', 'Bob' ]
Page 2: [ 'Charlie' ]

=== 更新文档 ===
Updated Alice age: 26

=== 乐观锁更新 ===
Updated Bob with optimistic locking

=== 删除文档 ===
Deleted Charlie

=== 最终统计 ===
Total users: 2
Remaining users: [ 'Alice', 'Bob' ]
\`\`\`

## 要点说明

### 1. 文档类型定义

所有文档必须继承 \`Document\` 接口：

\`\`\`typescript
interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}
\`\`\`

系统字段（\`id\`, \`_etag\`, \`_createdAt\`, \`_updatedAt\`）会自动添加。

### 2. 插入数据

插入时省略系统字段：

\`\`\`typescript
await users.insert({
  name: 'Alice',
  age: 25,
  email: 'alice@example.com',
  status: 'active'
});
\`\`\`

### 3. 查询操作符

支持 8 种操作符：

\`\`\`typescript
// $gte: 大于等于
{ age: { $gte: 25 } }

// $lt: 小于
{ age: { $lt: 35 } }

// 组合
{ age: { $gte: 25, $lt: 35 } }
\`\`\`

### 4. 乐观锁

使用 ETag 防止并发更新冲突：

\`\`\`typescript
await users.update(id, updates, { etag: current._etag });
\`\`\`

## 下一步

- [本地存储示例](./local-storage) - 持久化存储
- [生产部署示例](./production) - S3/OSS 配置
- [高级模式示例](./advanced) - 更多高级用法
```

**Step 3: 创建本地存储示例**

Create: `apps/website/examples/local-storage.md`

```markdown
# 本地存储示例

使用 FileSystemAdapter 进行本地持久化存储。

## 完整代码

\`\`\`typescript
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
    console.log(\`  - [\${todo.completed ? 'x' : ' '}] \${todo.title}\`);
  });

  console.log('\n=== 完成任务 ===');

  await todos.update(todo1.id, { completed: true });
  console.log('Marked as completed:', todo1.title);

  console.log('\n=== 查询未完成任务 ===');

  const pending = await todos.find({ completed: false });
  console.log('Pending tasks:');
  pending.forEach(todo => {
    console.log(\`  - [\${todo.priority}] \${todo.title}\`);
  });

  console.log('\n=== 数据已保存到本地 ===');
  console.log('数据目录:', adapter.config.basePath);
  console.log('重启程序后数据仍然存在');
}

main().catch(console.error);
\`\`\`

## 运行结果

\`\`\`
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
\`\`\`

## 目录结构

运行后会生成以下目录结构：

\`\`\`
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
\`\`\`

## 文件内容示例

### 文档文件（docs/a1b2c3d4-...-uuid.json）

\`\`\`json
{
  "id": "a1b2c3d4-e5f6-4g7h-8i9j-0k1l2m3n4o5p",
  "title": "学习 BucketDB",
  "completed": true,
  "priority": "high",
  "_etag": "etag-123-1709193600000",
  "_createdAt": "2026-02-28T10:00:00.000Z",
  "_updatedAt": "2026-02-28T10:05:00.000Z"
}
\`\`\`

### 索引分片文件（index/shard-00.json）

\`\`\`json
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
\`\`\`

## 要点说明

### 1. 数据持久化

FileSystemAdapter 会将所有数据保存到本地文件系统：

\`\`\`typescript
const adapter = new FileSystemAdapter({
  basePath: './local-db-data'  // 数据保存路径
});
\`\`\`

### 2. 重启后数据保留

\`\`\`typescript
// 第一次运行
const db1 = new BucketDB(adapter, 'todo-app');
await db1.collection<Todo>('todos').insert({ title: 'Task 1', ... });

// 重启程序后
const db2 = new BucketDB(adapter, 'todo-app');
const todos = await db2.collection<Todo>('todos').find({});
// todos 包含之前插入的数据
\`\`\`

### 3. .gitignore 配置

建议忽略本地数据库文件：

\`\`\`gitignore
# .gitignore
local-db-data/
*.local.json
\`\`\`

### 4. 多环境配置

\`\`\`typescript
const basePath = process.env.NODE_ENV === 'production'
  ? '/var/lib/myapp/data'
  : './local-db-data';

const adapter = new FileSystemAdapter({ basePath });
\`\`\`

## 适用场景

- ✅ 本地开发和测试
- ✅ 桌面应用
- ✅ 小规模服务器部署（单机）
- ✅ Serverless Edge Functions（读取操作）
- ❌ 多服务器集群（需要共享存储，使用 S3/OSS）

## 下一步

- [生产部署示例](./production) - 使用 S3/OSS
- [高级模式示例](./advanced) - 更多高级用法
```

**Step 4: 创建生产部署和高级模式示例（内容较长，简化）**

Create: `apps/website/examples/production.md` 和 `apps/website/examples/advanced.md`（内容从 `docs/API.md` 对应章节提取）

**Step 5: 测试示例页面**

Run: `cd apps/website && bun run dev`
Expected: 所有示例页面显示正常

**Step 6: 提交**

```bash
git add apps/website/examples/
git commit -m "feat: add examples documentation pages"
```

---

## Task 8: 构建和部署配置

**Files:**
- Create: `apps/website/vercel.json`
- Update: `.gitignore`

**Step 1: 创建 Vercel 配置**

Create: `apps/website/vercel.json`

```json
{
  "buildCommand": "bun run build",
  "outputDirectory": ".vitepress/dist",
  "installCommand": "bun install",
  "framework": "vitepress"
}
```

**Step 2: 更新根目录 .gitignore**

Add to `.gitignore`:

```
# Website
apps/website/.vitepress/cache
apps/website/.vitepress/dist
apps/website/api/*.md
!apps/website/api/index.md
```

**Step 3: 测试构建**

Run: `cd apps/website && bun run build`
Expected: 构建成功，生成 .vitepress/dist 目录

**Step 4: 测试预览**

Run: `cd apps/website && bun run preview`
Expected: 预览服务器启动，可以访问构建后的站点

**Step 5: 提交**

```bash
git add apps/website/vercel.json .gitignore
git commit -m "feat: add Vercel deployment configuration"
```

---

## Task 9: README 更新

**Files:**
- Update: `README.md`

**Step 1: 更新主 README**

在 README.md 中添加官网链接（假设部署到 bucket-db.vercel.app）：

```markdown
## 文档

📚 **官方网站**: https://bucket-db.vercel.app

- [快速开始](https://bucket-db.vercel.app/guide/)
- [API 参考](https://bucket-db.vercel.app/api/)
- [示例](https://bucket-db.vercel.app/examples/)
```

**Step 2: 提交**

```bash
git add README.md
git commit -m "docs: add official website link to README"
```

---

## 完成

计划完成并保存到 `docs/plans/2026-02-28-website-implementation.md`。

**两种执行方式**：

**1. Subagent-Driven（当前会话）** - 我为每个任务分发新的子 agent，任务间进行审查，快速迭代

**2. Parallel Session（独立会话）** - 在新会话中使用 executing-plans，批量执行并设置检查点

选择哪种方式？
