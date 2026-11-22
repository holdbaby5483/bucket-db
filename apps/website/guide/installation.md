# 安装指南

本指南介绍如何在项目中安装和配置 BucketDB。

## 环境要求

- **Node.js** 22+ 或 **Bun**（Node 20 已于 2026-04-30 停止维护，0.6 起不再支持）
- **TypeScript** 5.0+（推荐）

::: tip 0.6.0
当前版本为 0.6.0，1.0 之前最后一个包含不兼容变更的版本：`Collection` 只导出类型、返回的文档类型为 `Stored<T>`、`sort` 字段做类型检查、要求 Node.js 22+。从 0.5、0.4 或 0.3.x 升级请阅读[升级指南](./migration)。
:::

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

BucketDB 核心包 (`@hold-baby/bucket-db`) **没有任何运行时依赖**，包含：
- 核心数据库引擎
- 所有类型定义
- MemoryStorageAdapter（内存存储）
- FileSystemAdapter（文件系统存储）
- S3Adapter（AWS S3 及 S3 兼容服务）
- OSSAdapter（阿里云 OSS）
- 命令行工具 `bucket-db`（`npx @hold-baby/bucket-db <命令>`，见[命令行](./cli)）

S3 与 OSS 适配器使用内置的 S3 客户端（基于 Web Crypto 的 SigV4 签名），无需安装任何云厂商 SDK。`S3Adapter` 可通过 `endpoint` 连接任意 S3 兼容服务（MinIO、R2 等），但目前只在 AWS S3 和阿里云 OSS 上测试过。

## 连接字符串

`BucketDB.connect(url?, options?)` 用一个 URL 选择存储后端并创建数据库实例（同步）。不传 `url` 时读取环境变量 `BUCKET_DB_URL`；两者都没有时抛出 `ValidationError`。命令行工具和 MCP 服务器使用同样的 URL。

```typescript
import { BucketDB } from '@hold-baby/bucket-db';

const db = BucketDB.connect('s3://my-bucket/my-app?region=us-east-1');
// 或：export BUCKET_DB_URL=... 后
const db2 = BucketDB.connect();
```

| URL | 存储后端 | dbPath |
|-----|----------|--------|
| `s3://bucket/prefix?region=…&endpoint=…&forcePathStyle=true&timeoutMs=…` | `S3Adapter` | `prefix`（可含 `/`） |
| `oss://bucket/prefix?region=…&endpoint=…&timeoutMs=…` | `OSSAdapter` | `prefix` |
| `file:///absolute/dir` 或 `file://./relative/dir` | `FileSystemAdapter({ basePath: dir })` | `''` |
| `memory://prefix` | 新的 `MemoryStorageAdapter` | `prefix`（`memory://` 为 `''`） |

- 只接受上表列出的参数；`file://` 和 `memory://` 不接受参数。未知参数、不支持的协议、s3/oss 缺少 bucket 都抛出 `ValidationError`。
- `endpoint` 的值在查询字符串中需要 URL 编码，例如 `endpoint=http%3A%2F%2Flocalhost%3A9000`。
- 省略的参数使用下文各适配器的环境变量默认值。
- 凭证只来自环境变量：S3 为 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`；OSS 为 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_SESSION_TOKEN`，没有时使用 `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_SECURITY_TOKEN`（`aliyun/configure-aliyun-credentials-action` 通过 OIDC 导出的变量）。
- URL 不能含凭证：`s3://KEY:SECRET@bucket` 抛出 `ValidationError`，错误信息不会重复 URL，因此 URL 可以安全地打印到日志。
- 需要显式传入凭证或凭证函数时，直接构造适配器并使用 `new BucketDB(adapter, dbPath, options)`。

## 云存储配置

`region`、`endpoint`、`credentials` 都是可选的，未传入时从环境变量读取。

### S3Adapter

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';

// 全部从环境变量读取
const s3 = new S3Adapter({ bucket: 'my-bucket' });

// 或显式传入
const s3Explicit = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'AKIA...',
    secretAccessKey: '...',
    sessionToken: '...' // 可选
  }
});
```

| 配置 | 未传入时的默认值 |
|------|------------------|
| `region` | `AWS_REGION`，其次 `AWS_DEFAULT_REGION` |
| `endpoint` | `AWS_ENDPOINT_URL_S3`，其次 `AWS_ENDPOINT_URL`，否则 `https://s3.<region>.amazonaws.com` |
| `credentials` | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` |

### OSSAdapter

```typescript
import { OSSAdapter } from '@hold-baby/bucket-db';

const oss = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'cn-hangzhou' // 也接受 0.3 的写法 'oss-cn-hangzhou'
});
```

| 配置 | 未传入时的默认值 |
|------|------------------|
| `region` | `OSS_REGION` |
| `endpoint` | `https://s3.oss-<region>.aliyuncs.com`（OSS 的 S3 兼容 endpoint；不读取 `OSS_ENDPOINT`） |
| `credentials` | `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_SESSION_TOKEN`，其次 `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_SECURITY_TOKEN` |

::: warning OSS 自定义域名
中国内地新开通的 OSS 用户可能需要通过 `endpoint` 使用自定义域名。通过自定义域名进行 S3 兼容访问目前**未经验证**。
:::

### 通用说明

- 缺少 `region`（参数和环境变量都没有）时，构造函数抛出 `ValidationError`。
- 缺少凭证时，在第一次请求时抛出 `ValidationError`。
- `credentials` 也可以是返回凭证的异步函数（`CredentialProvider`）。函数结果会被缓存，并在 `expiresAt` 前 5 分钟重新调用（没有 `expiresAt` 则不再调用）；调用失败不会被缓存。
- endpoint 的主机是 IP 或 `localhost` 时自动使用 path-style 寻址（S3 可用 `forcePathStyle` 覆盖）。
- 请求失败时最多尝试 3 次（网络错误、超时、5xx、429、`SlowDown`、`RequestTimeout`），每次尝试的超时由 `timeoutMs` 控制，默认 10000 毫秒。

```typescript
// 你自己获取临时凭证的实现（例如 STS）
declare function fetchTemporaryCredentials(): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}>;

const s3WithProvider = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const c = await fetchTemporaryCredentials();
    return {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      sessionToken: c.sessionToken,
      expiresAt: new Date(c.expiration)
    };
  }
});
```

### 代理

S3 / OSS 客户端使用运行时内置的 `fetch`，是否走代理取决于运行时。以下结果是通过一个 CONNECT 代理访问真实 S3 bucket 实测的：

- **Bun**（1.4.2）默认遵循 `HTTPS_PROXY`。
- **Node**（22.23.5、24.22.3）默认**忽略** `HTTP_PROXY` / `HTTPS_PROXY`，直接连接（即使配置了一个不可达的代理，请求也会成功）。设置 `NODE_USE_ENV_PROXY=1`（Node 22.21.0+ / 24.0.0+）或使用参数 `--use-env-proxy`（Node 22.21.0+ / 24.5.0+）后请求经过代理。Node 将该功能标记为 "Stability 1.1 – Active development"。

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy:3128 npx -y @hold-baby/bucket-db count items
```

Bun 以及设置了 `NODE_USE_ENV_PROXY=1` 的 Node 都遵循 `NO_PROXY`（在 Bun 1.4.2 和 Node 24.22.3 上实测）：完整主机名、带或不带前导点的域名后缀（`.amazonaws.com`、`amazonaws.com`）以及 `*` 都会绕过代理。

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
npx tsx test.ts
```

如果看到 "BucketDB installed successfully!",说明安装成功。

## 下一步

- [快速开始](./index) - 5 分钟上手教程
- [核心概念](./concepts) - 理解 BucketDB 的核心概念
- [存储适配器](/api/adapters) - 选择合适的存储后端
