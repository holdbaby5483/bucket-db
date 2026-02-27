#!/usr/bin/env bun

/**
 * 从 docs/API.md 同步 API 文档到 apps/website/api/
 *
 * 将单个 API.md 文件按标题拆分为多个页面:
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
bun add @bucket-db/core
\`\`\`

## 基础用法

\`\`\`typescript
import { BucketDB, FileSystemAdapter } from '@bucket-db/core';
import type { Document } from '@bucket-db/core';

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

主数据库类,管理集合和配置。

\`\`\`typescript
const db = new BucketDB(adapter, dbPath, options);
const collection = db.collection<T>(name, options);
\`\`\`

详见 [BucketDB API](./bucketdb)。

### Collection

集合类,提供 CRUD 操作。

\`\`\`typescript
await collection.insert(data);
await collection.findById(id);
await collection.find(filter, options);
await collection.update(id, data, options);
await collection.delete(id);
\`\`\`

详见 [Collection API](./collection)。

## 存储适配器

- **MemoryStorageAdapter** - 内存存储(测试)
- **FileSystemAdapter** - 文件系统(本地开发)
- **S3Adapter** - AWS S3(生产)
- **OSSAdapter** - 阿里云 OSS(生产)

详见 [存储适配器 API](./adapters)。

## 类型系统

BucketDB 提供完整的 TypeScript 类型:

- \`Document\` - 文档基础类型
- \`QueryFilter<T>\` - 查询过滤器
- \`InsertDocument<T>\` - 插入文档类型
- \`UpdateDocument<T>\` - 更新文档类型

详见 [类型定义](./types)。

## 错误处理

所有错误继承自 \`BucketDBError\`:

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

主数据库类,管理集合和配置。

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

集合类,提供类型安全的 CRUD 操作。

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
      // 遇到下一个三级标题,停止
      if (line.startsWith('### ') && !line.startsWith(`### ${title}`)) {
        break;
      }
      result.push(line);
    }
  }

  return result.join('\n').trim();
}
