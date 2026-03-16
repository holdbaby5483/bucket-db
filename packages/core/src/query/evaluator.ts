import type { QueryValue, QueryFilter } from '../types/index.js';

/**
 * Allowed query operators (whitelist)
 */
const ALLOWED_OPERATORS = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'
]);

/**
 * Reserved field names that cannot be queried (security)
 */
const RESERVED_FIELDS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable'
]);

/**
 * Validate query filter for security
 */
function validateFilter<T extends Record<string, any>>(filter: QueryFilter<T>): void {
  for (const [field, condition] of Object.entries(filter)) {
    // Check for reserved field names
    if (RESERVED_FIELDS.has(field)) {
      throw new Error('Query contains forbidden field name');
    }

    // Validate operators if condition is an object
    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      for (const op of Object.keys(condition)) {
        if (!ALLOWED_OPERATORS.has(op)) {
          throw new Error('Query contains invalid operator');
        }
      }
    }
  }
}

/**
 * Evaluates a single operator condition
 */
export function evaluateOperator<T>(
  value: T,
  condition: QueryValue<T>
): boolean {
  // Direct value comparison (implicit $eq)
  if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) {
    return value === condition;
  }

  const operators = condition as Record<string, any>;

  // Check all operators (AND logic)
  for (const [op, operand] of Object.entries(operators)) {
    switch (op) {
      case '$eq':
        if (value !== operand) return false;
        break;

      case '$ne':
        if (value === operand) return false;
        break;

      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte':
        // Type check: only allow comparison for numbers and strings
        if (typeof value !== typeof operand) {
          throw new Error('Type mismatch in comparison operator');
        }
        if (typeof value !== 'number' && typeof value !== 'string') {
          throw new Error('Comparison operators require number or string values');
        }

        if (op === '$gt' && !(value > operand)) return false;
        if (op === '$gte' && !(value >= operand)) return false;
        if (op === '$lt' && !(value < operand)) return false;
        if (op === '$lte' && !(value <= operand)) return false;
        break;

      case '$in':
        if (!Array.isArray(operand)) {
          throw new Error('$in operator requires array operand');
        }
        if (operand.length === 0) return false; // Empty array never matches
        if (!operand.includes(value)) return false;
        break;

      case '$nin':
        if (!Array.isArray(operand)) {
          throw new Error('$nin operator requires array operand');
        }
        if (operand.length === 0) return true; // Empty array means nothing excluded
        if (operand.includes(value)) return false;
        break;

      default:
        // Should never reach here due to validateFilter check
        throw new Error('Invalid operator');
    }
  }

  return true;
}

/**
 * Evaluates a complete filter against a document
 */
export function evaluateFilter<T extends Record<string, any>>(
  document: T,
  filter: QueryFilter<T>
): boolean {
  // Empty filter matches all documents
  if (Object.keys(filter).length === 0) {
    return true;
  }

  // Validate filter for security
  validateFilter(filter);

  // All conditions must match (AND logic)
  for (const [field, condition] of Object.entries(filter)) {
    // Only access own properties, not inherited ones
    if (!Object.prototype.hasOwnProperty.call(document, field)) {
      return false;
    }

    const value = document[field];

    if (!evaluateOperator(value, condition as QueryValue<any>)) {
      return false;
    }
  }

  return true;
}
