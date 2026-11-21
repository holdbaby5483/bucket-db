import { describe, test, expect } from 'bun:test';
import { evaluateFilter } from '../../src/query.js';

/** Evaluates a single condition against a single value. */
const matches = (value: unknown, condition: unknown) => evaluateFilter({ v: value }, { v: condition });

describe('Query Evaluator', () => {
  describe('conditions', () => {
    test('$eq operator', () => {
      expect(matches(25, { $eq: 25 })).toBe(true);
      expect(matches(25, { $eq: 30 })).toBe(false);
      expect(matches('hello', { $eq: 'hello' })).toBe(true);
    });

    test('$ne operator', () => {
      expect(matches(25, { $ne: 30 })).toBe(true);
      expect(matches(25, { $ne: 25 })).toBe(false);
    });

    test('$gt operator', () => {
      expect(matches(30, { $gt: 25 })).toBe(true);
      expect(matches(25, { $gt: 25 })).toBe(false);
      expect(matches(20, { $gt: 25 })).toBe(false);
    });

    test('$gte operator', () => {
      expect(matches(30, { $gte: 25 })).toBe(true);
      expect(matches(25, { $gte: 25 })).toBe(true);
      expect(matches(20, { $gte: 25 })).toBe(false);
    });

    test('$lt operator', () => {
      expect(matches(20, { $lt: 25 })).toBe(true);
      expect(matches(25, { $lt: 25 })).toBe(false);
      expect(matches(30, { $lt: 25 })).toBe(false);
    });

    test('$lte operator', () => {
      expect(matches(20, { $lte: 25 })).toBe(true);
      expect(matches(25, { $lte: 25 })).toBe(true);
      expect(matches(30, { $lte: 25 })).toBe(false);
    });

    test('$in operator', () => {
      expect(matches('active', { $in: ['active', 'pending'] })).toBe(true);
      expect(matches('inactive', { $in: ['active', 'pending'] })).toBe(false);
      expect(matches(25, { $in: [20, 25, 30] })).toBe(true);
    });

    test('$nin operator', () => {
      expect(matches('inactive', { $nin: ['active', 'pending'] })).toBe(true);
      expect(matches('active', { $nin: ['active', 'pending'] })).toBe(false);
    });

    test('multiple operators combined', () => {
      expect(matches(25, { $gte: 18, $lt: 65 })).toBe(true);
      expect(matches(15, { $gte: 18, $lt: 65 })).toBe(false);
      expect(matches(70, { $gte: 18, $lt: 65 })).toBe(false);
    });

    test('direct value comparison (implicit $eq)', () => {
      expect(matches(25, 25)).toBe(true);
      expect(matches(25, 30)).toBe(false);
      expect(matches('test', 'test')).toBe(true);
    });
  });

  describe('evaluateFilter', () => {
    test('simple equality filter', () => {
      const doc = { id: '1', name: 'Alice', age: 25 };
      expect(evaluateFilter(doc, { name: 'Alice' })).toBe(true);
      expect(evaluateFilter(doc, { name: 'Bob' })).toBe(false);
    });

    test('multiple conditions (AND)', () => {
      const doc = { id: '1', name: 'Alice', age: 25, status: 'active' };
      expect(evaluateFilter(doc, { name: 'Alice', status: 'active' })).toBe(true);
      expect(evaluateFilter(doc, { name: 'Alice', status: 'inactive' })).toBe(false);
    });

    test('operator-based filter', () => {
      const doc = { id: '1', age: 25 };
      expect(evaluateFilter(doc, { age: { $gte: 18 } })).toBe(true);
      expect(evaluateFilter(doc, { age: { $gte: 30 } })).toBe(false);
    });

    test('complex filter with multiple operators', () => {
      const doc = { id: '1', age: 25, status: 'active' };
      expect(
        evaluateFilter(doc, {
          age: { $gte: 18, $lt: 65 },
          status: { $in: ['active', 'pending'] },
        })
      ).toBe(true);
    });

    test('empty filter matches all', () => {
      const doc = { id: '1', name: 'test' };
      expect(evaluateFilter(doc, {})).toBe(true);
    });

    test('missing field returns false', () => {
      const doc = { id: '1', name: 'test' };
      expect(evaluateFilter(doc, { age: 25 })).toBe(false);
    });
  });
});
