import type { QueryFilter } from './types.js';
import { ValidationError } from './errors.js';

const ALLOWED_OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin']);

/** Field names that would reach the prototype chain. */
const RESERVED_FIELDS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
]);

const isOperatorObject = (condition: unknown): condition is Record<string, unknown> =>
  typeof condition === 'object' && condition !== null && !Array.isArray(condition);

/**
 * Rejects reserved field names, unknown operators and non-array `$in` / `$nin` operands.
 */
export function validateFilter(filter: QueryFilter<unknown>): void {
  for (const [field, condition] of Object.entries(filter)) {
    if (RESERVED_FIELDS.has(field)) {
      throw new ValidationError(`Query contains forbidden field name: ${field}`);
    }
    if (!isOperatorObject(condition)) continue;
    for (const [operator, operand] of Object.entries(condition)) {
      if (!ALLOWED_OPERATORS.has(operator)) {
        throw new ValidationError(`Query contains invalid operator: ${operator}`);
      }
      if ((operator === '$in' || operator === '$nin') && !Array.isArray(operand)) {
        throw new ValidationError(`${operator} operator requires an array operand`);
      }
    }
  }
}

/** A missing field is `undefined`: it fails `$eq` / ranges / `$in` and satisfies `$ne` / `$nin`. */
function evaluateCondition(value: unknown, condition: unknown): boolean {
  // a plain value means $eq
  if (!isOperatorObject(condition)) return value === condition;

  // all operators must hold
  for (const [operator, operand] of Object.entries(condition)) {
    switch (operator) {
      case '$eq':
        if (value !== operand) return false;
        break;
      case '$ne':
        if (value === operand) return false;
        break;
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte': {
        // only number-to-number and string-to-string comparisons can match
        if (typeof value !== typeof operand || (typeof value !== 'number' && typeof value !== 'string')) return false;
        const right = operand as typeof value;
        if (operator === '$gt' && !(value > right)) return false;
        if (operator === '$gte' && !(value >= right)) return false;
        if (operator === '$lt' && !(value < right)) return false;
        if (operator === '$lte' && !(value <= right)) return false;
        break;
      }
      case '$in':
        if (!(operand as unknown[]).includes(value)) return false;
        break;
      case '$nin':
        if ((operand as unknown[]).includes(value)) return false;
        break;
    }
  }
  return true;
}

/**
 * True when `document` satisfies every condition in `filter` (AND).
 * Call `validateFilter` first.
 */
export function evaluateFilter(document: object, filter: QueryFilter<unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    const value = Object.hasOwn(document, field) ? (document as Record<string, unknown>)[field] : undefined;
    if (!evaluateCondition(value, condition)) return false;
  }
  return true;
}

/** booleans < numbers < strings < everything else (compared as JSON) */
function rank(value: unknown): number {
  const order = ['boolean', 'number', 'string'].indexOf(typeof value);
  return order === -1 ? 3 : order;
}

function compareValues(a: unknown, b: unknown): number {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const [left, right] = rank(a) === 3 ? [JSON.stringify(a), JSON.stringify(b)] : [a as string, b as string];
  return left < right ? -1 : left > right ? 1 : 0;
}

export type SortSpec = Partial<Record<string, 1 | -1>>;

/**
 * Sorts by the fields of `sort` in order (1 ascending, -1 descending), then by
 * `_createdAt` and `id`. Missing or null values sort last in either direction.
 * Fields set to `undefined` are ignored.
 */
export function sortDocuments<D extends object>(documents: D[], sort: SortSpec = {}): D[] {
  const keys: Array<[string, number]> = [];
  for (const [field, direction] of Object.entries(sort)) {
    if (direction === undefined) continue;
    if (RESERVED_FIELDS.has(field) || (direction !== 1 && direction !== -1)) {
      throw new ValidationError(`Invalid sort ${JSON.stringify({ [field]: direction })}: use 1 or -1 per field`);
    }
    keys.push([field, direction]);
  }
  for (const field of ['_createdAt', 'id']) if (!keys.some(([key]) => key === field)) keys.push([field, 1]);

  return documents.sort((a, b) => {
    for (const [field, direction] of keys) {
      const left = (a as Record<string, unknown>)[field] ?? undefined;
      const right = (b as Record<string, unknown>)[field] ?? undefined;
      if (left === undefined || right === undefined) {
        if (left !== right) return left === undefined ? 1 : -1;
        continue;
      }
      const order = compareValues(left, right) * direction;
      if (order !== 0) return order;
    }
    return 0;
  });
}
