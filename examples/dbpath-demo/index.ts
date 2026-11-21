import { BucketDB, MemoryStorageAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  age: number;
}

async function demonstrateDbPath() {
  const adapter = new MemoryStorageAdapter();

  // 使用 dbPath 创建数据库实例
  const db = new BucketDB(adapter, 'my-app');

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
  const { entries } = await adapter.list('');
  entries.forEach(({ key }) => {
    console.log(`  - ${key}`);
  });

  console.log('\n存储路径说明:');
  console.log(`  文档路径格式: {dbPath}/{collectionName}/docs/{id}.json`);
  console.log(`  实际文档路径: my-app/users/docs/${user.id}.json`);
  console.log('  每个文档就是一个对象，没有索引文件。');
}

await demonstrateDbPath();
