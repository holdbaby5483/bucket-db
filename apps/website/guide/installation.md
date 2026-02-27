# 安装指南

本指南介绍如何在项目中安装和配置 BucketDB。

## 环境要求

- **Node.js** 18+ 或 **Bun** 1.0+
- **TypeScript** 5.0+（推荐）

## 包管理器

### 使用 Bun（推荐）

```bash
bun add @bucket-db/core
```

### 使用 npm

```bash
npm install @bucket-db/core
```

### 使用 yarn

```bash
yarn add @bucket-db/core
```

### 使用 pnpm

```bash
pnpm add @bucket-db/core
```

## 依赖说明

BucketDB 核心包 (`@bucket-db/core`) 包含：
- 核心数据库引擎
- 所有类型定义
- MemoryStorageAdapter（内存存储）
- FileSystemAdapter（文件系统存储）
- S3Adapter（AWS S3 存储）
- OSSAdapter（阿里云 OSS 存储）

### 可选依赖

如果使用云存储适配器,相应的 SDK 会自动安装：
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
import { BucketDB, MemoryStorageAdapter } from '@bucket-db/core';

const db = new BucketDB(new MemoryStorageAdapter(), 'test');
console.log('BucketDB installed successfully!');
```

运行：

```bash
bun run test.ts
# 或
node --loader ts-node/esm test.ts
```

如果看到 "BucketDB installed successfully!",说明安装成功。

## 下一步

- [快速开始](./index) - 5 分钟上手教程
- [核心概念](./concepts) - 理解 BucketDB 的核心概念
- [存储适配器](/api/adapters) - 选择合适的存储后端
