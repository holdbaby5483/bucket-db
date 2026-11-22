# 凭证管理最佳实践

本文档说明如何安全地管理 BucketDB 云存储适配器（AWS S3、阿里云 OSS）的访问凭证。

## ⚠️ 安全原则

### 绝对禁止

❌ **硬编码凭证**
```typescript
// 危险！永远不要这样做
const s3Adapter = new S3Adapter({
  bucket: 'my-bucket',
  credentials: {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  }
});
```

❌ **提交凭证到 Git**
- 不要将 `.env` 文件提交到版本控制
- 检查 `.gitignore` 包含敏感文件

❌ **在日志中打印凭证**
```typescript
// 危险！
console.log('Using credentials:', credentials);
```

❌ **在客户端代码中暴露凭证**
- 永远不要在浏览器端使用长期凭证
- 使用临时凭证或预签名 URL

---

## ✅ 推荐实践

### 凭证从哪里来

`S3Adapter` 和 `OSSAdapter` 使用内置客户端，不依赖任何 SDK。`credentials` 参数有三种写法：

| 写法 | 行为 |
|---|---|
| 省略 | 第一次请求时从环境变量读取：S3 读 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`；OSS 读 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_SESSION_TOKEN`。缺少时抛 `ValidationError` |
| 对象 `{ accessKeyId, secretAccessKey, sessionToken? }` | 固定使用这组凭证 |
| 异步函数 `() => Promise<Credentials>` | 结果被缓存；返回值带 `expiresAt` 时，在到期前 5 分钟再次调用；调用失败不缓存，下次请求重新调用 |

```typescript
interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt?: Date;
}
type CredentialProvider = () => Promise<Credentials>;
```

内置客户端**不会**访问 EC2 实例元数据、ECS 容器凭证端点或 `~/.aws/credentials`。在这些环境里使用 IAM 角色 / RAM 角色时，用一个异步函数取得临时凭证并返回 `expiresAt`（见下文第 3、4 节）。AWS Lambda 会把角色的临时凭证放进 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN` 环境变量，省略 `credentials` 即可。

---

### 1. 使用环境变量

在本地开发或容器环境中，使用环境变量，代码里不出现凭证：

```typescript
import { S3Adapter, OSSAdapter } from '@hold-baby/bucket-db';

// 区域、端点、凭证都从 AWS_* 环境变量读取
const s3 = new S3Adapter({ bucket: process.env.S3_BUCKET! });

// 区域、凭证从 OSS_* 环境变量读取
const oss = new OSSAdapter({ bucket: process.env.OSS_BUCKET! });
```

**`.env` 文件**（不要提交到 Git）：
```bash
AWS_REGION=us-east-1
S3_BUCKET=my-bucket
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

OSS_REGION=cn-hangzhou
OSS_BUCKET=my-bucket
OSS_ACCESS_KEY_ID=your_access_key
OSS_ACCESS_KEY_SECRET=your_secret_key
```

这些变量名与 AWS CLI、ossutil 2.0 一致。`S3_BUCKET`、`OSS_BUCKET` 是本例自己约定的名字，BucketDB 不会读取。

**`.gitignore`**：
```
.env
.env.local
.env.*.local
```

**加载环境变量**：
```typescript
// Node.js 22+：node --env-file=.env app.js
// 或使用 dotenv
import 'dotenv/config';

// Bun 会自动加载 .env 文件
```

---

### 2. 使用密钥管理服务

把凭证存放在 AWS Secrets Manager、阿里云 KMS 凭据管家等服务中，用异步函数取出。下面的 `getSecret` 代表你所用服务的客户端调用：

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';
import { getSecret } from './secrets'; // 你的密钥管理客户端

const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const secret = JSON.parse(await getSecret('bucket-db/s3-credentials'));
    return {
      accessKeyId: secret.accessKeyId,
      secretAccessKey: secret.secretAccessKey,
    };
  },
});
```

不带 `expiresAt` 时函数只调用一次；轮换长期密钥后需要重启进程，或者返回一个 `expiresAt`，让适配器定期重新读取。

**创建密钥（AWS）**：
```bash
aws secretsmanager create-secret \
  --name bucket-db/s3-credentials \
  --secret-string '{"accessKeyId":"AKI...","secretAccessKey":"wJa..."}'
```

---

### 3. 使用临时凭证（STS）

临时凭证（AWS STS `AssumeRole`、阿里云 STS `AssumeRole`）带有 session token 和过期时间。返回 `expiresAt`，适配器会在过期前 5 分钟自动重新获取：

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';
import { assumeRole } from './sts'; // 你调用 STS 的代码

const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const { accessKeyId, secretAccessKey, sessionToken, expiration } = await assumeRole({
      roleArn: 'arn:aws:iam::123456789012:role/BucketDBRole',
      durationSeconds: 3600, // 1 小时
    });
    return { accessKeyId, secretAccessKey, sessionToken, expiresAt: new Date(expiration) };
  },
});
```

OSS 同理：

```typescript
import { OSSAdapter } from '@hold-baby/bucket-db';

const adapter = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'cn-hangzhou',
  credentials: async () => {
    const sts = await assumeAliyunRole(); // 你调用阿里云 STS 的代码
    return {
      accessKeyId: sts.AccessKeyId,
      secretAccessKey: sts.AccessKeySecret,
      sessionToken: sts.SecurityToken,
      expiresAt: new Date(sts.Expiration),
    };
  },
});
```

如果临时凭证已经由外部放进环境变量（`AWS_SESSION_TOKEN` / `OSS_SESSION_TOKEN`），省略 `credentials` 即可；但环境变量只在第一次请求时读取一次，过期后不会刷新，这种情况请改用异步函数。

**优点**：
- 凭证自动过期
- 可以限制权限范围
- 适合分布式系统

---

### 4. 在云主机上使用 IAM / RAM 角色

在 EC2 和阿里云 ECS 上，角色凭证由实例元数据服务提供；AWS ECS 任务的角色凭证由容器凭证端点（`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`）提供。内置客户端不会自动访问这些端点，需要在异步函数里读取并返回 `expiresAt`。例如 EC2 的 IMDSv2：

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';

const IMDS = 'http://169.254.169.254/latest';

async function ec2RoleCredentials() {
  const token = await fetch(`${IMDS}/api/token`, {
    method: 'PUT',
    headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' },
  }).then(r => r.text());
  const headers = { 'x-aws-ec2-metadata-token': token };
  const role = (await fetch(`${IMDS}/meta-data/iam/security-credentials/`, { headers }).then(r => r.text())).trim();
  const c = await fetch(`${IMDS}/meta-data/iam/security-credentials/${role}`, { headers }).then(r => r.json());
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.Token,
    expiresAt: new Date(c.Expiration),
  };
}

const adapter = new S3Adapter({ bucket: 'my-bucket', region: 'us-east-1', credentials: ec2RoleCredentials });
```

**优点**：
- 凭证自动轮换
- 无需管理密钥
- 权限通过 IAM / RAM 策略集中管理

---

## 🔒 凭证轮换

凭证函数本身就是轮换机制：返回 `expiresAt`，适配器在到期前 5 分钟重新调用函数。不需要自己写缓存类。

```typescript
const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const credentials = await getCredentialsFromSecretsManager(); // 你的代码
    // 每 24 小时重新读取一次
    return { ...credentials, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  },
});
```

不要在函数里打印返回的凭证。

---

## 📝 安全检查清单

使用此清单确保凭证安全：

- [ ] 凭证存储在环境变量或密钥管理服务中
- [ ] `.env` 文件已添加到 `.gitignore`
- [ ] 代码中不包含硬编码的密钥
- [ ] 日志不会打印凭证信息
- [ ] 部署环境使用 IAM 角色或密钥管理服务
- [ ] 定期轮换长期凭证（至少每90天）
- [ ] 客户端使用临时凭证或预签名 URL
- [ ] CI/CD 中使用加密的密钥变量

---

## 🚨 泄露响应

如果凭证泄露：

1. **立即撤销**
   ```bash
   # AWS
   aws iam delete-access-key --access-key-id AKIAIOSFODNN7EXAMPLE

   # 阿里云
   aliyun ram DeleteAccessKey --UserAccessKeyId LTAI...
   ```

2. **生成新凭证**
   - 通过控制台或 CLI 创建新密钥
   - 更新所有使用该凭证的服务

3. **检查日志**
   - 查看 CloudTrail（AWS）或 ActionTrail（阿里云）
   - 识别未授权的访问

4. **更新权限**
   - 审查 IAM 策略
   - 实施最小权限原则

---

## 📚 参考资源

- [AWS IAM 最佳实践](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [阿里云访问控制](https://help.aliyun.com/product/28625.html)
- [阿里云密钥管理服务](https://help.aliyun.com/product/28933.html)

---

## 💡 示例项目结构

```
my-project/
├── .env.example          # 示例配置（提交到 Git）
├── .env                  # 实际配置（不提交）
├── .gitignore           # 包含 .env
├── src/
│   ├── config/
│   │   └── storage.ts   # 凭证加载逻辑
│   └── index.ts
└── README.md            # 说明如何配置凭证
```

**`.env.example`**：
```bash
# AWS（S3Adapter 读取 AWS_*；S3_BUCKET 由应用读取）
AWS_REGION=us-east-1
S3_BUCKET=my-bucket
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here

# 阿里云（OSSAdapter 读取 OSS_*；OSS_BUCKET 由应用读取）
OSS_REGION=cn-hangzhou
OSS_BUCKET=my-bucket
OSS_ACCESS_KEY_ID=your_access_key_here
OSS_ACCESS_KEY_SECRET=your_secret_key_here
```

**`src/config/storage.ts`**：
```typescript
import { S3Adapter } from '@hold-baby/bucket-db';

export function createStorageAdapter() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('Missing required environment variable: S3_BUCKET');
  }

  // 区域和凭证从 AWS_* 环境变量读取：
  // 缺少区域时构造函数抛 ValidationError，缺少凭证时第一次请求抛 ValidationError
  return new S3Adapter({ bucket });
}
```
