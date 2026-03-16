import { BucketDB, MemoryStorageAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  age: number;
}

async function demonstrateDbPath() {
  const adapter = new MemoryStorageAdapter();

  // 使用 dbPath 创建数据库实例
  const db = new BucketDB(adapter, 'production-db');

  // 创建集合
  const users = db.collection<User>('users');

  // 插入文档
  const user = await users.insert({
    name: 'Alice',
    age: 25,
  });

  console.log('插入的文档:', user);
  console.log('\n存储键结构:');

  // 显示所有存储的键
  const allKeys = await adapter.listKeys('');
  allKeys.forEach(key => {
    console.log(`  - ${key}`);
  });

  console.log('\n存储路径说明:');
  console.log(`  文档路径格式: {dbPath}/{collectionName}/docs/{id}.json`);
  console.log(`  实际文档路径: production-db/users/docs/${user.id}.json`);
  console.log(`  索引路径格式: {dbPath}/{collectionName}/index/shard-{XX}.json`);
  console.log(`  实际索引路径: production-db/users/index/shard-*.json`);
}

demonstrateDbPath().catch(console.error);
