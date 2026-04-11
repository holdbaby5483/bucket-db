# 凭证管理最佳实践

本文档说明如何安全地管理 BucketDB 云存储适配器（AWS S3、阿里云 OSS）的访问凭证。

## ⚠️ 安全原则

### 绝对禁止

❌ **硬编码凭证**
```typescript
// 危险！永远不要这样做
const s3Adapter = new S3Adapter({
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

### 1. 使用 IAM 角色（最佳方案）

在 AWS EC2、ECS、Lambda 或阿里云 ECS 上运行时，使用 IAM 角色自动获取凭证：

```typescript
import { S3Adapter } from 'bucket-db';

// AWS SDK 会自动从 EC2/ECS 元数据服务获取凭证
const adapter = new S3Adapter({
  region: 'us-east-1',
  bucket: 'my-bucket',
  // 不需要提供 credentials
});
```

**优点**：
- 凭证自动轮换
- 无需管理密钥
- 权限通过 IAM 策略集中管理

**配置步骤（AWS）**：
1. 创建 IAM 角色，附加 S3 访问策略
2. 将角色分配给 EC2 实例或 ECS 任务
3. 应用自动获取凭证

---

### 2. 使用环境变量

在本地开发或容器环境中，使用环境变量：

```typescript
import { S3Adapter } from 'bucket-db';

const adapter = new S3Adapter({
  region: process.env.AWS_REGION!,
  bucket: process.env.S3_BUCKET!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

**`.env` 文件**（不要提交到 Git）：
```bash
AWS_REGION=us-east-1
S3_BUCKET=my-bucket
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

**`.gitignore`**：
```
.env
.env.local
.env.*.local
```

**加载环境变量**：
```typescript
// 使用 dotenv (Node.js)
import 'dotenv/config';

// 或 Bun 原生支持
// 自动加载 .env 文件
```

---

### 3. 使用密钥管理服务

#### AWS Secrets Manager

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Adapter } from 'bucket-db';

async function getCredentials() {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: 'bucket-db/s3-credentials' })
  );

  return JSON.parse(response.SecretString!);
}

// 使用
const credentials = await getCredentials();
const adapter = new S3Adapter({
  region: 'us-east-1',
  bucket: 'my-bucket',
  credentials,
});
```

**创建密钥**：
```bash
aws secretsmanager create-secret \
  --name bucket-db/s3-credentials \
  --secret-string '{"accessKeyId":"AKI...","secretAccessKey":"wJa..."}'
```

#### 阿里云 KMS

```typescript
import { KMS } from '@alicloud/kms-sdk';
import { OSSAdapter } from 'bucket-db';

async function getCredentials() {
  const kms = new KMS({
    endpoint: 'kms.cn-hangzhou.aliyuncs.com',
    accessKeyId: process.env.ALI_ACCESS_KEY_ID!,
    accessKeySecret: process.env.ALI_ACCESS_KEY_SECRET!,
  });

  const result = await kms.getSecretValue({
    SecretName: 'bucket-db/oss-credentials',
  });

  return JSON.parse(result.SecretData);
}
```

---

### 4. 使用临时凭证（STS）

对于需要在客户端访问的场景，使用临时凭证：

```typescript
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

async function getTemporaryCredentials(userId: string) {
  const sts = new STSClient({ region: 'us-east-1' });

  const response = await sts.send(
    new AssumeRoleCommand({
      RoleArn: 'arn:aws:iam::123456789012:role/BucketDBUserRole',
      RoleSessionName: `user-${userId}`,
      DurationSeconds: 3600, // 1小时
    })
  );

  return {
    accessKeyId: response.Credentials!.AccessKeyId!,
    secretAccessKey: response.Credentials!.SecretAccessKey!,
    sessionToken: response.Credentials!.SessionToken!,
  };
}

// 客户端使用
const tempCreds = await getTemporaryCredentials('user123');
const adapter = new S3Adapter({
  region: 'us-east-1',
  bucket: 'my-bucket',
  credentials: tempCreds,
});
```

**优点**：
- 凭证自动过期
- 可以限制权限范围
- 适合分布式系统

---

## 🔒 凭证轮换

### 定期轮换策略

```typescript
class CredentialManager {
  private credentials: any;
  private lastRotation: Date;
  private rotationInterval = 24 * 60 * 60 * 1000; // 24小时

  async getCredentials() {
    const now = new Date();
    if (!this.credentials || now.getTime() - this.lastRotation.getTime() > this.rotationInterval) {
      this.credentials = await this.rotateCredentials();
      this.lastRotation = now;
    }
    return this.credentials;
  }

  private async rotateCredentials() {
    // 从密钥管理服务获取最新凭证
    const newCredentials = await getCredentialsFromSecretsManager();
    console.log('Credentials rotated successfully');
    return newCredentials;
  }
}
```

---

## 📝 安全检查清单

使用此清单确保凭证安全：

- [ ] 凭证存储在环境变量或密钥管理服务中
- [ ] `.env` 文件已添加到 `.gitignore`
- [ ] 代码中不包含硬编码的密钥
- [ ] 日志不会打印凭证信息
- [ ] 生产环境使用 IAM 角色或密钥管理服务
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
# AWS Configuration
AWS_REGION=us-east-1
S3_BUCKET=my-bucket
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here

# Alibaba Cloud Configuration
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=my-bucket
ALI_ACCESS_KEY_ID=your_access_key_here
ALI_ACCESS_KEY_SECRET=your_secret_key_here
```

**`src/config/storage.ts`**：
```typescript
import { S3Adapter } from 'bucket-db';

export function createStorageAdapter() {
  // 验证环境变量
  const requiredEnvVars = ['AWS_REGION', 'S3_BUCKET'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  return new S3Adapter({
    region: process.env.AWS_REGION!,
    bucket: process.env.S3_BUCKET!,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        }
      : undefined, // 使用 IAM 角色
  });
}
```
