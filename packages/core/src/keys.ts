import { ValidationError } from './errors.js';

const NAME = /^[A-Za-z0-9_.-]{1,255}$/;

export function isValidName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value) && !value.startsWith('.');
}

/**
 * Collection names, document IDs and dbPath segments: 1-255 letters, digits,
 * `_`, `-` or `.`, not starting with `.`. Invalid input is rejected, never rewritten.
 */
export function validateName(kind: string, value: unknown): string {
  if (!isValidName(value)) {
    throw new ValidationError(
      `Invalid ${kind} ${JSON.stringify(value)}: use 1-255 letters, digits, '_', '-' or '.', not starting with '.'`
    );
  }
  return value;
}

/**
 * `dbPath` is a `/`-separated key prefix; `''` means the bucket root.
 */
export function validateDbPath(dbPath: unknown): string {
  if (dbPath === '') return dbPath;
  if (typeof dbPath !== 'string') throw new ValidationError(`Invalid dbPath ${JSON.stringify(dbPath)}`);
  for (const segment of dbPath.split('/')) validateName('dbPath segment', segment);
  return dbPath;
}

/** Key prefix under which a collection's documents live, ending with `/`. */
export function docsPrefix(dbPath: string, collection: string): string {
  return `${dbPath === '' ? '' : `${dbPath}/`}${collection}/docs/`;
}
