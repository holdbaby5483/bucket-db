import { describe, test, expect } from 'bun:test';
import { evaluateFilter, sortDocuments } from '../../src/query.js';
import { ValidationError } from '../../src/index.js';

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

  describe('settled semantics (0.5)', () => {
    test('a type mismatch is no match, not an error', () => {
      expect(matches(null, { $gt: 18 })).toBe(false);
      expect(matches('20', { $gt: 18 })).toBe(false);
      expect(matches(true, { $lte: 1 })).toBe(false);
      expect(matches(undefined, { $gte: 0 })).toBe(false);
    });

    test('$ne and $nin match a missing field; $eq, ranges and $in do not', () => {
      const doc = { id: '1' };
      expect(evaluateFilter(doc, { age: { $ne: 30 } })).toBe(true);
      expect(evaluateFilter(doc, { age: { $nin: [30] } })).toBe(true);
      expect(evaluateFilter(doc, { age: 30 })).toBe(false);
      expect(evaluateFilter(doc, { age: { $in: [30] } })).toBe(false);
      expect(evaluateFilter(doc, { age: { $lt: 30 } })).toBe(false);
    });

    test('an empty $nin excludes nothing and does not skip the other operators', () => {
      expect(matches(5, { $nin: [], $gt: 10 })).toBe(false);
      expect(matches(15, { $nin: [], $gt: 10 })).toBe(true);
      expect(matches(5, { $in: [] })).toBe(false);
    });
  });

  describe('sortDocuments', () => {
    const docs = () => [
      { id: 'c', n: 2, _createdAt: '2026-01-03' },
      { id: 'a', n: 1, _createdAt: '2026-01-02' },
      { id: 'b', _createdAt: '2026-01-01' },
      { id: 'd', n: 2, _createdAt: '2026-01-01' },
    ];
    const ids = (sorted: Array<{ id: string }>) => sorted.map(doc => doc.id);

    test('default order is _createdAt, then id', () => {
      expect(ids(sortDocuments(docs()))).toEqual(['b', 'd', 'a', 'c']);
    });

    test('missing values sort last in both directions; ties fall back to _createdAt', () => {
      expect(ids(sortDocuments(docs(), { n: 1 }))).toEqual(['a', 'd', 'c', 'b']);
      expect(ids(sortDocuments(docs(), { n: -1 }))).toEqual(['d', 'c', 'a', 'b']);
    });

    test('mixed types order as booleans < numbers < strings', () => {
      const mixed = [{ id: '1', v: 'x' }, { id: '2', v: 3 }, { id: '3', v: false }];
      expect(ids(sortDocuments(mixed, { v: 1 }))).toEqual(['3', '2', '1']);
    });

    test('an invalid direction or field is a ValidationError', () => {
      expect(() => sortDocuments([], { n: 2 as 1 })).toThrow(ValidationError);
      expect(() => sortDocuments([], { constructor: 1 })).toThrow(ValidationError);
    });
  });
});
