# 生产部署示例

使用 S3 和 OSS 云存储适配器进行生产环境部署。

## AWS S3 部署

### 配置 S3Adapter

```typescript
import { BucketDB, S3Adapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  email: string;
}

// 创建 S3 适配器
const adapter = new S3Adapter({
  bucket: 'my-app-bucket',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  }
});

// 创建数据库实例
const db = new BucketDB(adapter, 'production');
const users = db.collection<User>('users');

// 使用方式与其他适配器相同
await users.insert({ name: 'Alice', email: 'alice@example.com' });
const allUsers = await users.find({});
```

### 环境变量配置

创建 `.env` 文件：

```bash
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=us-east-1
S3_BUCKET=my-app-bucket
```

### 完整示例

```typescript
import { BucketDB, S3Adapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface Product extends Document {
  name: string;
  price: number;
  stock: number;
  category: string;
}

async function main() {
  // 从环境变量读取配置
  const adapter = new S3Adapter({
    bucket: process.env.S3_BUCKET!,
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    }
  });

  const db = new BucketDB(adapter, 'production');
  const products = db.collection<Product>('products');

  // 插入产品
  await products.insert({
    name: 'Laptop',
    price: 999,
    stock: 50,
    category: 'electronics'
  });

  // 查询产品
  const electronics = await products.find({ category: 'electronics' });
  console.log(`Found ${electronics.length} electronics`);

  // 分页查询
  const page1 = await products.find({}, { limit: 20, offset: 0 });
  console.log(`Page 1: ${page1.length} products`);
}

main().catch(console.error);
```

## 阿里云 OSS 部署

### 配置 OSSAdapter

```typescript
import { BucketDB, OSSAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface Order extends Document {
  userId: string;
  amount: number;
  status: 'pending' | 'completed' | 'cancelled';
}

// 创建 OSS 适配器
const adapter = new OSSAdapter({
  bucket: 'my-app-bucket',
  region: 'oss-cn-hangzhou',
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET!,
  }
});

const db = new BucketDB(adapter, 'production');
const orders = db.collection<Order>('orders');

// 使用
await orders.insert({
  userId: 'user-123',
  amount: 99.99,
  status: 'pending'
});
```

### 环境变量配置

```bash
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_secret_access_key
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=my-app-bucket
```

## 多环境配置

### 环境隔离策略

```typescript
import { BucketDB, S3Adapter, FileSystemAdapter } from '@hold-baby/bucket-db';

// 根据环境选择适配器
function createAdapter() {
  const env = process.env.NODE_ENV || 'development';

  if (env === 'production') {
    return new S3Adapter({
      bucket: process.env.S3_BUCKET!,
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      }
    });
  }

  if (env === 'test') {
    return new FileSystemAdapter({
      basePath: './test-data'
    });
  }

  // development
  return new FileSystemAdapter({
    basePath: './dev-data'
  });
}

// 使用不同的 dbPath 隔离环境
const env = process.env.NODE_ENV || 'development';
const db = new BucketDB(createAdapter(), env);
```

## 最佳实践

### 1. 使用环境变量

```typescript
// ✅ 好：从环境变量读取
const adapter = new S3Adapter({
  bucket: process.env.S3_BUCKET!,
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  }
});

// ❌ 差：硬编码凭证
const adapter = new S3Adapter({
  bucket: 'my-bucket',
  credentials: {
    accessKeyId: 'AKIAXXXXXXXX',
    secretAccessKey: 'xxxxxx',
  }
});
```

### 2. 错误处理

```typescript
import { StorageError } from '@hold-baby/bucket-db';

try {
  await users.insert({ name: 'Alice', email: 'alice@example.com' });
} catch (error) {
  if (error instanceof StorageError) {
    console.error('Storage error:', error.message);
    // 重试或降级处理
  }
  throw error;
}
```

### 3. 分片配置

生产环境建议增加分片数量：

```typescript
const users = db.collection<User>('users', {
  shardCount: 32  // 增加到 32 个分片
});
```

### 4. 连接复用

```typescript
// ✅ 好：复用 adapter 和 db 实例
const adapter = createAdapter();
const db = new BucketDB(adapter, 'production');

export { db };  // 导出供全局使用

// ❌ 差：每次创建新实例
function getDB() {
  return new BucketDB(createAdapter(), 'production');
}
```

## 性能优化

### 1. 批量操作

```typescript
// 批量插入
const users = [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
];

await Promise.all(
  users.map(user => collection.insert(user))
);
```

### 2. 并行查询

```typescript
// 并行查询多个分片
const [activeUsers, inactiveUsers] = await Promise.all([
  users.find({ status: 'active' }),
  users.find({ status: 'inactive' })
]);
```

### 3. 分页大结果集

```typescript
async function* getAllUsers() {
  let offset = 0;
  const limit = 100;

  while (true) {
    const batch = await users.find({}, { limit, offset });
    if (batch.length === 0) break;

    yield batch;
    offset += batch.length;

    if (batch.length < limit) break;
  }
}

// 使用
for await (const batch of getAllUsers()) {
  console.log(`Processing ${batch.length} users`);
  // 处理批次
}
```

## 监控和日志

```typescript
import { BucketDB } from '@hold-baby/bucket-db';

class MonitoredDB {
  private db: BucketDB;

  constructor(adapter: any, dbPath: string) {
    this.db = new BucketDB(adapter, dbPath);
  }

  async insert<T>(collectionName: string, data: any): Promise<T> {
    const start = Date.now();
    try {
      const result = await this.db.collection<T>(collectionName).insert(data);
      console.log(`Insert ${collectionName}: ${Date.now() - start}ms`);
      return result;
    } catch (error) {
      console.error(`Insert ${collectionName} failed:`, error);
      throw error;
    }
  }
}
```

## 下一步

- [高级模式示例](./advanced) - 更多高级用法
- [存储适配器 API](/api/adapters) - 完整的适配器 API
