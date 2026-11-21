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

// 同步 llms.txt 到 public 目录
const LLMS_SOURCE = join(process.cwd(), '../../packages/core/llms.txt');
const LLMS_TARGET = join(process.cwd(), 'public/llms.txt');
if (existsSync(LLMS_SOURCE)) {
  writeFileSync(LLMS_TARGET, readFileSync(LLMS_SOURCE, 'utf-8'));
  console.log('  ✓ public/llms.txt');
}

console.log('✅ API 文档同步完成');

/**
 * 转义 Markdown 标题中的 HTML 特殊字符
 * VitePress/Vue 会把 <T> 解析为 HTML 标签，需要转义
 */
function escapeMarkdownHeadings(content: string): string {
  return content.split('\n').map(line => {
    // 只处理标题行 (以 # 开头)
    if (line.match(/^#{1,6}\s/)) {
      return line.replace(/<(\w+)>/g, '&lt;$1&gt;');
    }
    return line;
  }).join('\n');
}

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

BucketDB 0.4.0-beta.0 完整的 API 文档。从 0.3.x 升级请先阅读[升级指南](/guide/migration)。

## 快速导航

- [BucketDB 类](./bucketdb) - 数据库主类
- [Collection 类](./collection) - 集合操作
- [存储适配器](./adapters) - 存储后端
- [类型定义](./types) - TypeScript 类型
- [错误类](./errors) - 错误处理

## 安装

\`\`\`bash
bun add @hold-baby/bucket-db@next
\`\`\`

## 基础用法

\`\`\`typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  email: string;
}

const db = new BucketDB(new FileSystemAdapter({ basePath: './data' }), 'my-app');

const users = db.collection<User>('users');

await users.insert({ name: 'Alice', email: 'alice@example.com' });
const all = await users.find({});
\`\`\`

## 核心类

### BucketDB

入口类:存储后端加上一个 key 前缀(\`dbPath\`,\`''\` 表示 bucket 根目录)。

\`\`\`typescript
const db = new BucketDB(adapter, dbPath);
const collection = db.collection<T>(name);
\`\`\`

详见 [BucketDB API](./bucketdb)。

### Collection

集合类,提供 CRUD 操作。每个文档是一个对象:\`<dbPath>/<collection>/docs/<id>.json\`。

\`\`\`typescript
await collection.insert(data);              // 1 次条件 PUT
await collection.findById(id);              // 1 次 GET;仅在文档不存在时返回 null
await collection.find(filter, options);     // LIST + 读取全部文档,内存中过滤
await collection.update(id, data, options); // GET + 条件 PUT
await collection.delete(id);                // 1 次 DELETE;文档不存在也不报错
\`\`\`

详见 [Collection API](./collection)。

## 存储适配器

- **MemoryStorageAdapter** - 内存存储(测试)
- **FileSystemAdapter** - 本地文件系统
- **S3Adapter** - AWS S3 及 S3 兼容服务(内置客户端,无运行时依赖;区域、端点、凭证可从 \`AWS_*\` 环境变量读取)
- **OSSAdapter** - 阿里云 OSS,经 S3 兼容端点访问(区域、凭证可从 \`OSS_*\` 环境变量读取;不支持条件更新)

S3 与 OSS 每个请求最多尝试 3 次,单次超时默认 10 秒,重试网络错误、超时、5xx、429、\`SlowDown\`、\`RequestTimeout\`。

详见 [存储适配器 API](./adapters)。

## 各后端保证

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| 单次写入原子 | 是 | 是 | 是 | 是 |
| 不存在才创建(\`insert\`) | 是 | 是(跨进程) | 是 | 是(仅限未开启版本控制的 bucket) |
| 条件更新(\`etag\`) | 是 | 仅单进程 | 是 | 否,抛 \`UnsupportedError\` |
| 并发局部更新全部生效 | 是 | 仅单进程 | 是 | 否(后写覆盖) |

所有后端都支持多个进程并发 \`insert\` / \`delete\`;\`update\` 的多进程并发仅 S3 支持(Memory、FileSystem 限单进程内)。

## 使用限制

1. **没有事务** - 每次写入只涉及一个文档。
2. **每次 \`find\` 都读取全部文档** - 只有 \`{ id: '...' }\` 查询只读一个文档。尚无基准测试(计划在 0.4.0 提供),不承诺任何容量;适用于小集合(数千个文档)、每秒几次写入。
3. **OSS 不支持条件更新** - 带 \`etag\` 的 \`update\` 抛 \`UnsupportedError\`;不带 \`etag\` 的并发 \`update\` 后写覆盖。
4. **FileSystem 的条件更新仅限单进程** - \`etag\` 校验和并发更新合并只在同一进程内成立。
5. **0.3.x 与 0.4 不能同时写同一个集合** - 0.3 只读自己的索引,看不到 0.4 的写入。
6. **Beta** - 0.4.0 正式版之前 API 仍可能调整。

## 类型系统

BucketDB 提供完整的 TypeScript 类型:

- \`Document\` - 文档基础类型
- \`QueryFilter<T>\` - 查询过滤器
- \`InsertDocument<T>\` - 插入文档类型
- \`UpdateDocument<T>\` - 更新文档类型

详见 [类型定义](./types)。

## 错误处理

以下错误类都继承自 \`BucketDBError\`:

- \`ValidationError\` - 集合名、文档 ID、\`dbPath\` 或查询条件不合法;适配器参数不合法;缺少凭证
- \`DocumentNotFoundError\` - \`update\` 的文档不存在(\`findById\` 返回 \`null\`,\`delete\` 直接成功)
- \`ConcurrentUpdateError\` - \`update\` 的 \`etag\` 已过期、带 \`etag\` 时写入竞争失败,或不带 \`etag\` 时重试 5 次后仍冲突
- \`UnsupportedError\` - 后端不具备所需能力(OSS 上带 \`etag\` 的 \`update\`)
- \`StorageError\` - 底层存储失败,带 \`kind\`(\`'not-found'\` / \`'conflict'\` / \`'transient'\` / \`'permanent'\`)、\`key\`、\`status\`

集合名、文档 ID 和 \`dbPath\` 的每一段须为 1-255 个字母、数字、\`_\`、\`-\` 或 \`.\`,且不能以 \`.\` 开头;不合规直接抛 \`ValidationError\`,不会改写。

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

  writeFileSync(join(TARGET_DIR, 'collection.md'), escapeMarkdownHeadings(content));
  console.log('  ✓ api/collection.md');
}

/**
 * 生成适配器页面
 */
function generateAdaptersPage(sections: Map<string, string>) {
  const content = sections.get('Storage Adapters') || '';

  writeFileSync(join(TARGET_DIR, 'adapters.md'), escapeMarkdownHeadings(content));
  console.log('  ✓ api/adapters.md');
}

/**
 * 生成类型页面
 */
function generateTypesPage(sections: Map<string, string>) {
  const content = sections.get('Type Definitions') || '';

  writeFileSync(join(TARGET_DIR, 'types.md'), escapeMarkdownHeadings(content));
  console.log('  ✓ api/types.md');
}

/**
 * 生成错误类页面
 */
function generateErrorsPage(sections: Map<string, string>) {
  const content = sections.get('Error Classes') || '';

  writeFileSync(join(TARGET_DIR, 'errors.md'), escapeMarkdownHeadings(content));
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
