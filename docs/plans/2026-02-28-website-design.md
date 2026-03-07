# BucketDB 官网设计文档

**日期**: 2026-02-28
**版本**: v1.0
**状态**: 设计完成，待实现

---

## 概述

为 BucketDB 创建一个官方网站，包含项目介绍、完整的 API 文档和使用示例。官网将服务于两类主要用户：开发者（需要技术文档）和决策者（需要了解产品价值）。

## 设计决策

### 技术选型

**静态站点生成器：VitePress**

选择理由：
- 专为技术文档设计，开箱即用的特性完善
- 基于 Vite，构建速度极快
- Markdown 增强功能（代码高亮、容器、前置元数据）
- 内置搜索、暗色模式、响应式设计
- Vue 3 生态，可扩展性强
- 与 TypeScript 项目契合度高

**内容展示方式：代码示例 + 运行结果**

不采用交互式 Playground 的原因：
- 开发成本高，需要打包整个库到浏览器
- 代码示例 + 预期输出已足够说明 API 用法
- 用户可以快速复制到本地运行（examples 已提供完整示例）

**架构方案：独立官网项目（apps/website）**

选择理由：
- 清晰的关注点分离（官网面向用户，docs/ 面向贡献者）
- 灵活的内容组织（可按用户阅读习惯重组文档）
- 独立部署（官网更新不影响主仓库）
- 符合 monorepo 最佳实践（apps/* 用于应用）

---

## 项目结构

```
bucket-db/
├── apps/
│   └── website/                     # 官网应用
│       ├── .vitepress/
│       │   ├── config.ts            # VitePress 配置
│       │   ├── theme/               # 主题定制（可选）
│       │   │   └── index.ts
│       │   └── dist/                # 构建输出（.gitignore）
│       ├── public/
│       │   ├── logo.svg             # Logo
│       │   └── favicon.ico
│       ├── scripts/
│       │   └── sync-api-docs.ts     # 内容同步脚本
│       ├── index.md                 # 首页（营销页面）
│       ├── guide/
│       │   ├── index.md             # 快速开始
│       │   ├── installation.md      # 安装指南
│       │   ├── quick-start.md       # 快速上手教程
│       │   ├── concepts.md          # 核心概念
│       │   ├── queries.md           # 查询语法
│       │   └── error-handling.md    # 错误处理
│       ├── api/
│       │   ├── index.md             # API 概览
│       │   ├── bucketdb.md          # BucketDB 类
│       │   ├── collection.md        # Collection 类
│       │   ├── adapters.md          # 存储适配器
│       │   ├── types.md             # 类型定义
│       │   └── errors.md            # 错误类
│       ├── examples/
│       │   ├── index.md             # 示例索引
│       │   ├── basic-usage.md       # 基础 CRUD
│       │   ├── local-storage.md     # 本地开发
│       │   ├── production.md        # 生产部署（S3/OSS）
│       │   └── advanced.md          # 高级模式（分页、乐观锁等）
│       ├── package.json
│       └── tsconfig.json
├── docs/                            # 项目文档（保持不变）
│   ├── API.md                       # 单一来源（源文档）
│   └── plans/
└── packages/
```

---

## 页面结构与内容规划

### 1. 首页（index.md）

**布局**：`layout: home`（VitePress 内置首页布局）

**内容区块**：

**Hero 区域**：
```yaml
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
```

**核心特性**（6-8 个卡片）：
- 🚀 **无服务器架构** - 使用云对象存储，无需维护数据库服务器
- 📦 **类型安全** - 完整的 TypeScript 类型推断和严格模式
- ☁️ **多云支持** - AWS S3、阿里云 OSS、本地文件系统统一 API
- 🔍 **灵活查询** - 8 种查询操作符，支持复杂条件组合
- 🔒 **并发安全** - 基于 ETag 的乐观锁保证数据一致性
- 📊 **可扩展索引** - 分片索引设计，支持数十万文档
- 🎯 **多租户隔离** - dbPath 支持多环境/多租户数据隔离
- ✅ **测试完善** - 132 个自动化测试确保代码质量

**快速示例**：
```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db-core';

const db = new BucketDB(new FileSystemAdapter({ basePath: './data' }), 'my-app');
const users = db.collection<User>('users');

// 插入文档
const user = await users.insert({ name: 'Alice', age: 25 });

// 查询文档
const adults = await users.find({ age: { $gte: 18 } });
```

**为什么选择 BucketDB**：
- 对比传统数据库（无需运维、成本按用量计费）
- 对比其他文档数据库（类型安全、多云支持）
- 适用场景（中小规模、读多写少、云原生应用）

**开始使用**：
```bash
bun add @hold-baby/bucket-db-core
```

---

### 2. 指南部分（/guide）

#### 快速开始（index.md）

5 分钟教程，从安装到第一个查询：
1. 安装依赖
2. 创建数据库实例
3. 定义文档类型
4. 插入数据
5. 查询数据
6. 更新和删除

#### 安装指南（installation.md）

- Bun/npm/yarn/pnpm 安装方式
- 依赖说明（@aws-sdk/client-s3, ali-oss）
- TypeScript 配置要求
- 验证安装

#### 核心概念（concepts.md）

- **数据库（BucketDB）** - 数据库实例，通过 dbPath 隔离
- **集合（Collection）** - 文档容器，类似表
- **文档（Document）** - 基本存储单元，包含系统字段
- **存储适配器（StorageAdapter）** - 抽象存储层
- **索引分片（Index Sharding）** - 性能优化机制
- **乐观锁（Optimistic Locking）** - 并发控制

#### 查询语法（queries.md）

- 所有查询操作符详解（$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin）
- 组合查询（AND 逻辑）
- 分页查询（limit, offset）
- 最佳实践

#### 错误处理（error-handling.md）

- 错误类型（DocumentNotFoundError, ConcurrentUpdateError 等）
- 重试模式（乐观锁冲突重试）
- 最佳实践

---

### 3. API 参考（/api）

从 `docs/API.md` 重组为多个页面：

#### API 概览（index.md）

- 快速导航到各个类
- 安装和导入
- 基础用法概览

#### BucketDB 类（bucketdb.md）

- 构造函数
- `collection()` 方法
- 配置选项（defaultShardCount）
- 使用示例

#### Collection 类（collection.md）

- `insert()` - 插入文档
- `findById()` - 按 ID 查找
- `find()` - 查询文档
- `update()` - 更新文档
- `delete()` - 删除文档
- 每个方法包含完整类型签名和示例

#### 存储适配器（adapters.md）

- **MemoryStorageAdapter** - 内存存储（测试用）
- **FileSystemAdapter** - 文件系统存储（本地开发）
- **S3Adapter** - AWS S3 存储（生产）
- **OSSAdapter** - 阿里云 OSS 存储（生产）
- 每个适配器的配置和使用示例

#### 类型定义（types.md）

- Document
- InsertDocument<T>
- UpdateDocument<T>
- QueryFilter<T>
- QueryValue<T>
- QueryOptions
- UpdateOptions

#### 错误类（errors.md）

- BucketDBError
- DocumentNotFoundError
- ConcurrentUpdateError
- ValidationError
- StorageError

---

### 4. 示例展示（/examples）

#### 示例索引（index.md）

所有示例的导航页面

#### 基础用法（basic-usage.md）

```typescript
// 完整的 CRUD 示例
// 包含代码 + 运行结果说明
```

#### 本地存储（local-storage.md）

```typescript
// FileSystemAdapter 完整示例
// 目录结构说明
// 数据持久化验证
```

#### 生产部署（production.md）

```typescript
// S3Adapter 配置示例
// OSSAdapter 配置示例
// 环境变量管理
// 最佳实践
```

#### 高级模式（advanced.md）

- 分页查询完整示例
- 乐观锁重试模式
- 多租户/多环境隔离
- 性能优化建议

---

## VitePress 配置

### 配置文件（.vitepress/config.ts）

```typescript
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'BucketDB',
  description: 'TypeScript document database built on cloud object storage',

  // 基础路径（如果部署到子路径）
  base: '/',

  // 主题配置
  themeConfig: {
    logo: '/logo.svg',

    // 导航栏
    nav: [
      { text: '指南', link: '/guide/' },
      { text: 'API', link: '/api/' },
      { text: '示例', link: '/examples/' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/.../releases' },
          { text: 'Contributing', link: 'https://github.com/.../blob/main/CONTRIBUTING.md' }
        ]
      }
    ],

    // 侧边栏
    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/guide/' },
            { text: '安装指南', link: '/guide/installation' },
            { text: '快速上手', link: '/guide/quick-start' }
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

    // 社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/[username]/bucket-db' }
    ],

    // 页脚
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present'
    },

    // 编辑链接
    editLink: {
      pattern: 'https://github.com/[username]/bucket-db/edit/main/apps/website/:path',
      text: '在 GitHub 上编辑此页'
    },

    // 搜索
    search: {
      provider: 'local'
    }
  },

  // Markdown 配置
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true
  }
});
```

---

## 内容同步策略

### 问题

`docs/API.md` 是 API 文档的单一来源，但官网需要将其拆分为多个独立页面以提升用户体验。

### 解决方案

**构建时脚本**（`apps/website/scripts/sync-api-docs.ts`）：

功能：
1. 读取 `../../docs/API.md`
2. 按 Markdown 标题分割章节
3. 生成对应的 `api/*.md` 文件
4. 调整内部链接和引用

**执行时机**：
- 开发时：手动运行 `bun run sync`
- 构建时：自动执行（build 脚本依赖）
- 部署前：CI/CD 自动运行

**同步内容**：
- `docs/API.md` → `api/*.md`（自动分割）
- `docs/plans/IMPLEMENTATION_STATUS.md` 部分内容 → 首页特性说明（手动维护）
- `examples/*/index.ts` 代码 → `examples/*.md`（代码块嵌入，手动或脚本）

### 维护流程

**API 文档更新**：
1. 修改 `docs/API.md`（单一来源）
2. 运行 `cd apps/website && bun run sync`
3. 检查生成的 `api/*.md` 文件
4. 提交更改

**指南/示例更新**：
1. 直接在 `apps/website/guide/` 或 `examples/` 中编辑
2. 无需同步

**部署前检查**：
- CI/CD 自动运行 sync 脚本确保内容最新
- 构建成功后部署

---

## 开发工作流

### 包配置（apps/website/package.json）

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
    "vitepress": "^1.0.0",
    "vue": "^3.4.0"
  }
}
```

### 本地开发

```bash
# 进入官网目录
cd apps/website

# 安装依赖
bun install

# 同步 API 文档
bun run sync

# 启动开发服务器
bun run dev
# 访问 http://localhost:5173
```

### 构建部署

```bash
# 构建（自动同步）
bun run build

# 预览构建结果
bun run preview
```

---

## 部署配置

### Vercel（推荐）

**配置文件**（`vercel.json` 或项目设置）：

```json
{
  "buildCommand": "cd apps/website && bun install && bun run build",
  "outputDirectory": "apps/website/.vitepress/dist",
  "installCommand": "bun install"
}
```

**自动部署**：
- Push 到 main 分支自动部署生产环境
- Pull Request 自动部署预览环境

### Netlify

**配置文件**（`netlify.toml`）：

```toml
[build]
  base = "apps/website"
  command = "bun install && bun run build"
  publish = ".vitepress/dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## SEO 优化

### 页面元数据

每个页面的 frontmatter：

```yaml
---
title: BucketDB - 快速开始
description: 5 分钟学会使用 BucketDB 进行文档存储和查询
head:
  - - meta
    - property: og:title
      content: BucketDB - 快速开始
  - - meta
    - property: og:description
      content: 5 分钟学会使用 BucketDB 进行文档存储和查询
---
```

### Sitemap

VitePress 自动生成 sitemap.xml

### 社交媒体预览

配置 Open Graph 和 Twitter Card 元数据

---

## 设计原则

### 内容组织

- **用户为中心** - 按用户学习路径组织，而非代码结构
- **渐进式** - 从快速上手到深入概念到完整 API
- **实例驱动** - 每个概念都配合代码示例

### 文档风格

- **简洁清晰** - 避免冗余，直接说明
- **代码优先** - TypeScript 类型签名 + 实际示例
- **可扫描** - 使用标题、列表、代码块便于快速扫描

### 用户体验

- **快速导航** - 清晰的侧边栏和面包屑
- **搜索友好** - 本地搜索覆盖所有内容
- **响应式** - 移动端友好
- **暗色模式** - 自动切换

---

## 待办事项

### Phase 1 - 基础搭建

- [ ] 创建 `apps/website` 项目结构
- [ ] 配置 VitePress
- [ ] 设计首页布局和内容
- [ ] 添加 Logo 和图标资源

### Phase 2 - 内容迁移

- [ ] 编写内容同步脚本
- [ ] 同步 API 文档并拆分
- [ ] 编写指南页面
- [ ] 编写示例页面

### Phase 3 - 优化和发布

- [ ] SEO 优化
- [ ] 配置部署（Vercel/Netlify）
- [ ] 测试所有链接和导航
- [ ] 更新主 README 链接到官网

---

## 成功标准

- ✅ 用户能在 5 分钟内理解 BucketDB 的核心价值
- ✅ 用户能在 10 分钟内完成第一个功能实现
- ✅ API 文档完整覆盖所有公开接口
- ✅ 所有示例代码可以直接运行
- ✅ 搜索功能能快速找到相关内容
- ✅ 移动端访问体验良好
- ✅ 页面加载速度 < 2 秒

---

## 附录

### 参考资料

- VitePress 官方文档：https://vitepress.dev
- 优秀案例：
  - Vite 官网：https://vitejs.dev
  - Vue 官网：https://vuejs.org
  - Drizzle ORM：https://orm.drizzle.team

### 技术限制

- VitePress 仅支持静态站点，无服务端逻辑
- 本地搜索有内容大小限制（建议 < 500 页）
- 需要现代浏览器支持（ES2020+）

### 未来扩展

- 交互式 Playground（Phase 2）
- 性能基准对比页面
- 社区贡献的第三方适配器展示
- 博客/更新日志集成
