import { describe, test, expect } from 'bun:test';
import { evaluateFilter, evaluateOperator } from '../../src/query/evaluator';
describe('Query Evaluator', () => {
    describe('evaluateOperator', () => {
        test('$eq operator', () => {
            expect(evaluateOperator(25, { $eq: 25 })).toBe(true);
            expect(evaluateOperator(25, { $eq: 30 })).toBe(false);
            expect(evaluateOperator('hello', { $eq: 'hello' })).toBe(true);
        });
        test('$ne operator', () => {
            expect(evaluateOperator(25, { $ne: 30 })).toBe(true);
            expect(evaluateOperator(25, { $ne: 25 })).toBe(false);
        });
        test('$gt operator', () => {
            expect(evaluateOperator(30, { $gt: 25 })).toBe(true);
            expect(evaluateOperator(25, { $gt: 25 })).toBe(false);
            expect(evaluateOperator(20, { $gt: 25 })).toBe(false);
        });
        test('$gte operator', () => {
            expect(evaluateOperator(30, { $gte: 25 })).toBe(true);
            expect(evaluateOperator(25, { $gte: 25 })).toBe(true);
            expect(evaluateOperator(20, { $gte: 25 })).toBe(false);
        });
        test('$lt operator', () => {
            expect(evaluateOperator(20, { $lt: 25 })).toBe(true);
            expect(evaluateOperator(25, { $lt: 25 })).toBe(false);
            expect(evaluateOperator(30, { $lt: 25 })).toBe(false);
        });
        test('$lte operator', () => {
            expect(evaluateOperator(20, { $lte: 25 })).toBe(true);
            expect(evaluateOperator(25, { $lte: 25 })).toBe(true);
            expect(evaluateOperator(30, { $lte: 25 })).toBe(false);
        });
        test('$in operator', () => {
            expect(evaluateOperator('active', { $in: ['active', 'pending'] })).toBe(true);
            expect(evaluateOperator('inactive', { $in: ['active', 'pending'] })).toBe(false);
            expect(evaluateOperator(25, { $in: [20, 25, 30] })).toBe(true);
        });
        test('$nin operator', () => {
            expect(evaluateOperator('inactive', { $nin: ['active', 'pending'] })).toBe(true);
            expect(evaluateOperator('active', { $nin: ['active', 'pending'] })).toBe(false);
        });
        test('multiple operators combined', () => {
            expect(evaluateOperator(25, { $gte: 18, $lt: 65 })).toBe(true);
            expect(evaluateOperator(15, { $gte: 18, $lt: 65 })).toBe(false);
            expect(evaluateOperator(70, { $gte: 18, $lt: 65 })).toBe(false);
        });
        test('direct value comparison (implicit $eq)', () => {
            expect(evaluateOperator(25, 25)).toBe(true);
            expect(evaluateOperator(25, 30)).toBe(false);
            expect(evaluateOperator('test', 'test')).toBe(true);
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
            expect(evaluateFilter(doc, {
                age: { $gte: 18, $lt: 65 },
                status: { $in: ['active', 'pending'] },
            })).toBe(true);
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
//# sourceMappingURL=evaluator.test.js.map