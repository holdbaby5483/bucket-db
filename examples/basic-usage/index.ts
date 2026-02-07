import { BucketDB, MemoryStorageAdapter } from '@bucket-db/core';
import type { Document } from '@bucket-db/core';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

async function main() {
  // Create database with memory adapter
  const adapter = new MemoryStorageAdapter();
  const db = new BucketDB(adapter, 'my-app');

  // Get users collection
  const users = db.collection<User>('users');

  console.log('Inserting users...');
  const alice = await users.insert({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com',
    status: 'active',
  });
  console.log('Inserted:', alice);

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

  console.log('\nFinding active users...');
  const activeUsers = await users.find({ status: 'active' });
  console.log('Active users:', activeUsers.length);

  console.log('\nFinding users aged 25+...');
  const adults = await users.find({ age: { $gte: 25 } });
  console.log('Users 25+:', adults.length);

  console.log('\nUpdating Alice...');
  const updated = await users.update(alice.id, { age: 26 });
  console.log('Updated:', updated);

  console.log('\nDeleting Charlie...');
  const allUsers = await users.find({});
  const charlie = allUsers.find(u => u.name === 'Charlie');
  if (charlie) {
    await users.delete(charlie.id);
    console.log('Deleted Charlie');
  }

  console.log('\nFinal count:');
  const all = await users.find({});
  console.log('Total users:', all.length);
}

main().catch(console.error);
