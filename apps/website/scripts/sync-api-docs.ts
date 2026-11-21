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
- **FileSystemAdapter** - 本地文件系统
- **S3Adapter** - AWS S3(原生条件写入;SDK 默认重试,最多尝试 3 次,覆盖 5xx/429/网络错误)
- **OSSAdapter** - 阿里云 OSS(条件写入为 HEAD + PUT 模拟,非原子;仅重试网络错误和超时,5xx/429 不重试)

详见 [存储适配器 API](./adapters)。

## 使用限制

当前版本(0.3.x)存在以下限制:

1. **仅支持单写入者** - 每个集合只使用一个写入进程。不支持多个实例/进程写入同一集合:一个实例的 WAL 恢复可能重放并清除另一个运行中实例的未完成操作,且 OSS 的条件写入不是原子的。
   - **OSS 上一次只能有一个写入** - 即使在同一进程内,OSS 上的并发写入也不安全:在真实 bucket 上测试,向新集合并发 20 次 \`insert\` 全部成功返回,但 \`find({})\` 只返回 16 条(索引条目被静默丢失);用同一 \`etag\` 并发 10 次 \`update\` 全部成功。请等待每次 \`insert\` / \`update\` / \`delete\` 完成后再发起下一次。
   - **S3、FileSystem、Memory 上**,同一进程内的并发写入会被检测到而不会丢失,但竞争激烈时,写入可能在索引分片尝试 3 次后以 \`StorageError\`("PreconditionFailed")失败。被拒绝的 \`insert\` / \`update\` 可能已写入文档;其 WAL 条目会保留,并可能在下次构造 \`Collection\` 时被重放进索引。
2. **WAL 不提供恢复保证** - WAL 只重放索引条目,从不重放文档。写入过程中崩溃可能导致索引与文档不一致(例如索引中存在从未写入的文档,或已删除的文档仍能被 \`findById\` 读到)。恢复在构造 \`Collection\` 时于后台运行,且不会被等待。
3. **OSS 没有原子条件写入** - \`OSSAdapter\` 用"先 HEAD 再 PUT"模拟 \`ifMatch\` / \`ifNoneMatch\`,两个并发写入者(即使在同一进程内)可能同时通过检查;在 OSS 上带 \`etag\` 的 \`update\` 无法阻止并发覆盖,并发写入还可能丢失索引条目。需要乐观锁请使用 S3。
4. **\`findById\` 读取失败时返回 \`null\`** - 文档不存在时返回 \`null\`,目前存储读取失败(如网络、权限错误)时也返回 \`null\`。
5. **没有规模基准测试** - 不承诺任何文档数量上限。成本模型:每个文档存为 \`<dbPath>/<collection>/docs/<id>.json\`;分片索引(默认 16 个分片,\`index/shard-XX.json\`)保存每个文档的完整副本;WAL(\`wal/\`)记录每次写入。每次写入都会重写一整个索引分片;每次非 \`id\` 条件的 \`find\` 都会下载所有非空分片。没有查询缓存,每次 \`find\` 都读取存储。

## 类型系统

BucketDB 提供完整的 TypeScript 类型:

- \`Document\` - 文档基础类型
- \`QueryFilter<T>\` - 查询过滤器
- \`InsertDocument<T>\` - 插入文档类型
- \`UpdateDocument<T>\` - 更新文档类型

详见 [类型定义](./types)。

## 错误处理

以下错误类继承自 \`BucketDBError\`:

- \`DocumentNotFoundError\` - \`update\` / \`delete\` 的文档不存在(\`findById\` 返回 \`null\`,不抛出)
- \`ConcurrentUpdateError\` - \`update\` 传入的 \`etag\` 已过期,或在 \`update\` 读取与写入之间文档被其他写入者修改;\`delete\` 没有 \`etag\` 参数,不会抛出此错误
- \`ValidationError\` - 已导出,但当前版本不会抛出
- \`StorageError\` - 底层存储失败

非法的集合名或文档 ID 会抛出 \`PathValidationError\`,它未被导出,且继承自 \`Error\` 而非 \`BucketDBError\`。

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
