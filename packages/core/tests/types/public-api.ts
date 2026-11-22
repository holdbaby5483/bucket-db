/**
 * Compile-time checks of the public API's types; checked by `tsc -p tests/types`
 * (`bun run --cwd packages/core typecheck`), never executed. A line marked
 * @ts-expect-error fails the check if it stops being an error.
 */
import { BucketDB, MemoryStorageAdapter } from '../../src/index.js';
import type { Collection, Document, Stored, SortSpec } from '../../src/index.js';

interface Run extends Document {
  ms: number;
  sha: string;
}

export async function publicApi() {
  const runs: Collection<Run> = new BucketDB(new MemoryStorageAdapter(), 'db').collection<Run>('runs');

  // Returned documents always carry an etag.
  const inserted = await runs.insert({ ms: 1, sha: 'a' });
  const etag: string = inserted._etag;
  const found: Stored<Run> | null = await runs.findById(inserted.id);
  const updated: Stored<Run> = await runs.update(inserted.id, { ms: 2 }, { etag });

  // Sort keys are the document's fields plus the system fields.
  const sort: SortSpec<Run> = { ms: -1, _createdAt: 1, id: 1 };
  const listed: Stored<Run>[] = await runs.find({ ms: { $gte: 1 } }, { sort, limit: 10 });
  // @ts-expect-error unknown sort field
  await runs.find({}, { sort: { msx: 1 } });
  // @ts-expect-error sort direction must be 1 or -1
  await runs.find({}, { sort: { ms: 2 } });

  // insert / put / update accept no system fields.
  // @ts-expect-error id comes from the key, not the data
  await runs.insert({ ms: 1, sha: 'a', id: 'x' });
  // @ts-expect-error _createdAt is managed by BucketDB
  await runs.update(inserted.id, { _createdAt: 'x' });

  return [found, updated, listed];
}

// @ts-expect-error Collection is exported as a type only
export const notAConstructor = new (await import('../../src/index.js')).Collection();
