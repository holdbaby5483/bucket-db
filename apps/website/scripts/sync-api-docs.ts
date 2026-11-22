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
 * VitePress/Vue 会把 <T> 解析为 HTML 标签，需要转义；
 * 反引号内的行内代码不解析 HTML 实体，转义后会显示成字面的 &lt;，所以跳过
 */
function escapeMarkdownHeadings(content: string): string {
  return content.split('\n').map(line => {
    // 只处理标题行 (以 # 开头)
    if (!line.match(/^#{1,6}\s/)) return line;
    // 按反引号切分，奇数段是行内代码
    return line
      .split('`')
      .map((part, index) => (index % 2 === 1 ? part : part.replace(/<(\w+)>/g, '&lt;$1&gt;')))
      .join('`');
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

BucketDB 0.6.0 完整的 API 文档,需要 Node.js 22+ 或 Bun。从 0.5、0.4 或 0.3.x 升级请先阅读[升级指南](/guide/migration)(涵盖 0.5 → 0.6、0.4 → 0.5 与 0.3 → 0.4);各后端的保证及对应测试见[保证与限制](/guide/guarantees),存储布局见[存储格式](/guide/storage-format)。命令行工具 \`bucket-db\` 见[命令行(CLI)](/guide/cli)。

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
import { BucketDB } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  email: string;
}

// 等价于 new BucketDB(new FileSystemAdapter({ basePath: './data' }), '')
const db = BucketDB.connect('file://./data');

const users = db.collection<User>('users');

await users.insert({ name: 'Alice', email: 'alice@example.com' });
const all = await users.find({});
\`\`\`

## 核心类

### BucketDB

入口类:存储后端加上一个 key 前缀(\`dbPath\`,\`''\` 表示 bucket 根目录),可选的第三个参数 \`{ logger }\` 接收快照写入失败和超出包络的警告(默认 \`console.warn\`)。

\`BucketDB.connect(url?, options?)\` 用一个 URL 同步创建实例,省略 \`url\` 时读取 \`BUCKET_DB_URL\`:\`s3://bucket/prefix?region=…\`、\`oss://bucket/prefix?region=…\`、\`file:///dir\`、\`memory://prefix\`。路径部分成为 \`dbPath\`;凭证只从环境变量读取,URL 中包含凭证会被拒绝。

\`\`\`typescript
const db = new BucketDB(adapter, dbPath, { logger });
const db2 = BucketDB.connect('s3://my-bucket/my-app?region=us-east-1', { logger });
const collection = db.collection<T>(name);
\`\`\`

详见 [BucketDB API](./bucketdb)。

### Collection

集合类,提供 CRUD 操作,只能通过 \`db.collection<T>(name)\` 获取;\`Collection\` 只导出类型(\`import type { Collection }\`),没有公开的构造函数。返回的文档类型为 \`Stored<T>\`(\`_etag\` 一定有值)。每个文档是一个对象:\`<dbPath>/<collection>/docs/<id>.json\`;S3 / OSS 上每个集合还有一个可丢弃的查询快照 \`<dbPath>/<collection>/_snapshot.v1.json\`。

\`\`\`typescript
await collection.insert(data);              // 1 次条件 PUT
await collection.insert(data, { id });      // 1 次条件 PUT;id 已存在抛 DocumentExistsError
await collection.put(id, data);             // 1 次无条件 PUT;创建或整体替换,可重复执行
await collection.findById(id);              // 1 次 GET;仅在文档不存在时返回 null
await collection.find(filter, options);     // LIST + 快照(S3/OSS)或读取全部文档(Memory/FileSystem),内存中过滤
await collection.find(filter, { sort: { age: -1 }, limit: 10 }); // 成本同上;默认按 _createdAt、id 升序
await collection.count();                   // 每 1000 个文档 1 次 LIST,不读取文档
await collection.count(filter);             // 成本同 find(filter)
await collection.update(id, data, options); // GET + 条件 PUT
await collection.delete(id);                // 1 次 DELETE;文档不存在也不报错
await collection.deleteMany(filter);        // find(filter) + 每个匹配 1 次 DELETE(16 个并发);非原子
await collection.compact();                 // S3/OSS:按当前文档重建快照;本地后端无操作
\`\`\`

详见 [Collection API](./collection)。

## 存储适配器

- **MemoryStorageAdapter** - 内存存储(测试)
- **FileSystemAdapter** - 本地文件系统
- **S3Adapter** - AWS S3 及 S3 兼容服务(内置客户端,无运行时依赖;区域、端点、凭证可从 \`AWS_*\` 环境变量读取;\`remote: true\`,查询使用快照)
- **OSSAdapter** - 阿里云 OSS,经 S3 兼容端点访问(区域、凭证可从 \`OSS_*\` 环境变量读取,凭证缺失时改读 \`ALIBABA_CLOUD_*\`;不支持条件更新;\`remote: true\`,查询使用快照)

S3 与 OSS 每个请求最多尝试 3 次,单次超时默认 10 秒,重试网络错误、超时、5xx、429、\`SlowDown\`、\`RequestTimeout\`。

详见 [存储适配器 API](./adapters)。

## 各后端保证

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| 单次写入原子 | 是 | 是 | 是 | 是 |
| 不存在才创建(\`insert\`) | 是 | 是(跨进程) | 是 | 是(仅限未开启版本控制的 bucket) |
| 条件更新(\`etag\`) | 是 | 仅单进程 | 是 | 否,抛 \`UnsupportedError\` |
| 并发局部更新全部生效 | 是 | 仅单进程 | 是 | 否(后写覆盖) |

所有后端都支持多个进程并发 \`insert\` / \`put\` / \`delete\`;\`update\` 的多进程并发仅 S3 支持(Memory、FileSystem 限单进程内)。

## 使用限制

1. **没有事务** - 每次写入只涉及一个文档。
2. **包络:每个集合最多 10,000 个文档、快照最大 10 MB** - 超出后查询仍可用但越来越慢,集合会记录一次警告。实测 10,000 个文档时一次 \`find\`:OSS 1.35 秒、S3 3.2 秒、FileSystem 约 0.5 秒(见 [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md))。
3. **查询会列出整个集合** - 在内存中过滤,\`sort\` / \`limit\` / \`offset\` 不减少读取。S3 / OSS 从快照取文档内容,只 GET 快照之后变更过的文档;Memory / FileSystem 每次读取全部文档。只有 \`{ id: '...' }\` 查询只读一个文档。
4. **结果集不是某一时刻的快照** - 返回的每个文档都是某个已提交的版本,但查询期间写入的文档可能出现也可能不出现。
5. **快照包含文档内容** - 已删除文档的内容会留在快照里,直到快照被重写或调用 \`compact()\`。
6. **OSS 不支持条件更新** - 带 \`etag\` 的 \`update\` 抛 \`UnsupportedError\`;不带 \`etag\` 的并发 \`update\` 后写覆盖。
7. **FileSystem 的条件更新仅限单进程** - \`etag\` 校验和并发更新合并只在同一进程内成立。
8. **0.3.x 与 0.4 不能同时写同一个集合** - 0.3 只读自己的索引,看不到 0.4 的写入。
9. **\`deleteMany\` 不是原子操作** - 中途失败时已删除的文档不会恢复,调用期间写入的文档可能不会被删除。

## 类型系统

BucketDB 提供完整的 TypeScript 类型:

- \`Document\` - 文档基础类型
- \`Stored<T>\` - 集合返回的文档类型,\`T & { _etag: string }\`
- \`QueryFilter<T>\` - 查询过滤器
- \`InsertDocument<T>\` - 插入文档类型
- \`UpdateDocument<T>\` - 更新文档类型
- \`InsertOptions\` - \`insert\` 选项(\`{ id }\`)
- \`QueryOptions<T>\` - \`find\` 选项(\`limit\` / \`offset\` / \`sort\`)
- \`SortSpec<T>\` - \`sort\` 的类型:\`T\` 的字段加系统字段,未知字段编译报错
- \`BucketDBOptions\` / \`Logger\` / \`LogEvent\` - 日志回调
- \`Collection<T>\` - 集合类型(只导出类型)

详见 [类型定义](./types)。

## 错误处理

以下错误类都继承自 \`BucketDBError\`:

- \`ValidationError\` - 集合名、文档 ID、\`dbPath\`、查询条件或排序参数不合法;适配器参数不合法;缺少凭证;连接 URL 不合法(未知协议或参数、缺少 bucket、URL 含凭证,或未传 URL 且未设置 \`BUCKET_DB_URL\`)
- \`DocumentExistsError\` - \`insert(data, { id })\` 的 id 已存在
- \`DocumentNotFoundError\` - \`update\` 的文档不存在(\`findById\` 返回 \`null\`,\`delete\` 直接成功)
- \`ConcurrentUpdateError\` - \`update\` 的 \`etag\` 已过期、带 \`etag\` 时写入竞争失败,或不带 \`etag\` 时重试 5 次后仍冲突
- \`UnsupportedError\` - 后端不具备所需能力(OSS 上带 \`etag\` 的 \`update\`)
- \`StorageError\` - 底层存储失败,带 \`kind\`(\`'not-found'\` / \`'conflict'\` / \`'transient'\` / \`'permanent'\`)、\`key\`、\`status\`;S3 / OSS 上读取快照失败(不存在除外)也会让 \`find\` 抛出。快照写入失败不抛出,交给 \`logger\`

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
