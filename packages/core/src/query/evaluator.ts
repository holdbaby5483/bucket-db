import type { QueryValue, QueryFilter } from '@bucket-db/types';

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
        if (!(value > operand)) return false;
        break;

      case '$gte':
        if (!(value >= operand)) return false;
        break;

      case '$lt':
        if (!(value < operand)) return false;
        break;

      case '$lte':
        if (!(value <= operand)) return false;
        break;

      case '$in':
        if (!Array.isArray(operand) || !operand.includes(value)) return false;
        break;

      case '$nin':
        if (!Array.isArray(operand) || operand.includes(value)) return false;
        break;

      default:
        throw new Error(`Unknown operator: ${op}`);
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

  // All conditions must match (AND logic)
  for (const [field, condition] of Object.entries(filter)) {
    const value = document[field];

    // If field doesn't exist in document, fail the match
    if (value === undefined) {
      return false;
    }

    if (!evaluateOperator(value, condition as QueryValue<any>)) {
      return false;
    }
  }

  return true;
}
