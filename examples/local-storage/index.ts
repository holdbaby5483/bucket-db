import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';
import { existsSync, rmSync } from 'fs';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

async function main() {
  // 清理旧数据
  const dbPath = './local-db-data';
  if (existsSync(dbPath)) {
    rmSync(dbPath, { recursive: true, force: true });
  }

  console.log('使用本地文件系统存储适配器\n');

  // 创建本地文件系统适配器
  const adapter = new FileSystemAdapter({
    basePath: dbPath,
  });

  // 创建数据库实例
  const db = new BucketDB(adapter, 'my-app');

  // 获取用户集合
  const users = db.collection<User>('users');

  console.log('插入用户...');
  const alice = await users.insert({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com',
    status: 'active',
  });
  console.log('插入:', alice);

  await users.insert({
    name: 'Bob',
    age: 30,
    email: 'bob@example.com',
    status: 'active',
  });

  await users.insert({
    name: 'Charlie',
    age: 35,
    email: 'charlie@example.com',
    status: 'inactive',
  });

  console.log('\n查找活跃用户...');
  const activeUsers = await users.find({ status: 'active' });
  console.log('活跃用户数:', activeUsers.length);
  activeUsers.forEach(user => {
    console.log(`  - ${user.name}, ${user.age}岁`);
  });

  console.log('\n查找 25 岁以上的用户...');
  const adults = await users.find({ age: { $gte: 25 } });
  console.log('25+ 用户数:', adults.length);

  console.log('\n更新 Alice 的年龄...');
  const updated = await users.update(alice.id, { age: 26 });
  console.log('更新后:', updated);

  console.log('\n文件系统存储结构:');
  console.log(`  数据目录: ${dbPath}/`);
  console.log(`  文档: ${dbPath}/my-app/users/docs/*.json`);
  console.log(`  索引: ${dbPath}/my-app/users/index/shard-*.json`);
  console.log(`  元数据: *.meta 文件存储 ETag 信息`);

  console.log('\n数据已持久化到本地文件系统！');
  console.log('重启程序后数据仍然存在。');
}

main().catch(console.error);
