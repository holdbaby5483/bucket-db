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
      link: https://github.com/holdbaby5483/bucket-db
    - theme: alt
      text: npm 包
      link: https://www.npmjs.com/package/@hold-baby/bucket-db

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
    title: 乐观锁
    details: update 支持基于 ETag 的冲突检测;S3 为原子条件写入,OSS 为非原子模拟
  - icon: 📊
    title: 分片索引
    details: 索引按文档 ID 哈希分片,每次写入只重写一个分片
  - icon: 🎯
    title: 多租户隔离
    details: 通过 dbPath 参数实现多环境、多租户的数据完全隔离
  - icon: ✅
    title: 自动化测试
    details: 核心功能由自动化测试覆盖
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

## 为什么选择 BucketDB?

### 🎯 适用场景

- **读多写少** - 查询频繁,写入不密集,且只有一个写入进程
- **数据量可接受全量索引下载** - 每次非 `id` 查询都会下载整个索引(见下方成本模型)
- **云原生** - 已使用云服务,希望简化架构
- **类型安全** - TypeScript 项目,需要完整类型支持

### ⚠️ 当前限制(0.3.x)

- **仅支持单写入者** - 每个集合只使用一个写入进程。不支持多个实例/进程写入同一集合:一个实例的 WAL 恢复可能重放并清除另一个运行中实例的未完成操作,且 OSS 的条件写入不是原子的。
- **OSS 上一次只能有一个写入** - 即使在同一进程内,OSS 上的并发写入也不安全:在真实 bucket 上测试,向新集合并发 20 次 `insert` 全部成功返回,但 `find({})` 只返回 16 条(索引条目被静默丢失);用同一 `etag` 并发 10 次 `update` 全部成功。请等待每次 `insert` / `update` / `delete` 完成后再发起下一次。
- **S3、FileSystem、Memory 上的并发写入** - 同一进程内的并发写入会被检测到而不会丢失,但竞争激烈时,写入可能在索引分片尝试 3 次后以 `StorageError`("PreconditionFailed")失败。被拒绝的 `insert` / `update` 可能已写入文档;其 WAL 条目会保留,并可能在下次构造 `Collection` 时被重放进索引。
- **WAL 不提供恢复保证** - WAL 只重放索引条目,从不重放文档。写入中途崩溃可能导致索引与文档不一致(例如索引中存在从未写入的文档,或已删除的文档仍能被 `findById` 读到)。恢复在构造 `Collection` 时于后台运行,且不会被等待。
- **OSS 没有原子条件写入** - `OSSAdapter` 用"先 HEAD 再 PUT"模拟 `ifMatch` / `ifNoneMatch`,两个并发写入者(即使在同一进程内)可能同时通过检查;在 OSS 上带 `etag` 的 `update` 无法阻止并发覆盖。需要乐观锁请使用 S3。
- **`findById` 读取失败时返回 `null`** - 文档不存在时返回 `null`,目前存储读取失败(如网络、权限错误)时也返回 `null`。
- **没有规模基准测试** - 不承诺文档数量上限。成本模型:每个文档存为 `<dbPath>/<collection>/docs/<id>.json`;分片索引(默认 16 个分片)保存每个文档的完整副本;WAL 记录每次写入。每次写入重写一整个索引分片;每次非 `id` 条件的 `find` 下载所有非空分片。
- **重试** - S3 使用 AWS SDK 默认重试(最多尝试 3 次,覆盖 5xx/429/网络错误);OSS 仅重试网络错误和超时,5xx 与 429 不重试。

详见[核心概念 - 使用限制](/guide/concepts#使用限制)。

### ⚡ 核心优势

**vs 传统数据库**
- 无需运维数据库服务器 - 数据直接存放在对象存储中
- 成本优化 - 按实际存储和请求付费,无最低消费
- 可用性与持久性 - 由底层云对象存储提供

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

立即查看[快速开始指南](/guide/),5 分钟完成第一个应用。
