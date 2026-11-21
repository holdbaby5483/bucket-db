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

function evaluateCondition(value: unknown, condition: unknown): boolean {
  // a plain value means $eq
  if (!isOperatorObject(condition)) {
    return value === condition;
  }

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
        if (typeof value !== typeof operand) {
          throw new ValidationError('Type mismatch in comparison operator');
        }
        if (typeof value !== 'number' && typeof value !== 'string') {
          throw new ValidationError('Comparison operators require number or string values');
        }
        const right = operand as typeof value;
        if (operator === '$gt' && !(value > right)) return false;
        if (operator === '$gte' && !(value >= right)) return false;
        if (operator === '$lt' && !(value < right)) return false;
        if (operator === '$lte' && !(value <= right)) return false;
        break;
      }
      case '$in': {
        const values = operand as unknown[];
        if (values.length === 0 || !values.includes(value)) return false;
        break;
      }
      case '$nin': {
        const values = operand as unknown[];
        // 0.3 behaviour, kept until query semantics are settled in M2
        if (values.length === 0) return true;
        if (values.includes(value)) return false;
        break;
      }
    }
  }
  return true;
}

/**
 * True when `document` satisfies every condition in `filter` (AND).
 * Call `validateFilter` first.
 */
export function evaluateFilter(document: Record<string, unknown>, filter: QueryFilter<unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (!Object.prototype.hasOwnProperty.call(document, field)) return false;
    if (!evaluateCondition(document[field], condition)) return false;
  }
  return true;
}
