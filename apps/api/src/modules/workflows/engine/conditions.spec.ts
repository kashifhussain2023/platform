import type { Condition } from '@vaep/types';
import { evaluateConditions } from './conditions';

/**
 * Unit spec for the EVENT condition DSL evaluator (docs §5.2). Pure, offline —
 * no DB/Redis. Mirrors the fired-event payload shape `{ eventId, subject, data }`.
 */
describe('evaluateConditions', () => {
  const payload = {
    eventId: 'evt_1',
    subject: { type: 'candidate', email: 'a@b.com' },
    data: {
      amount: 2000,
      currency: 'USD',
      title: 'Enterprise renewal',
      labels: ['vip', 'renewal'],
      paid: true,
      count: 0,
    },
  };

  it('empty / absent conditions always pass (back-compat)', () => {
    expect(evaluateConditions(undefined, payload)).toBe(true);
    expect(evaluateConditions(null, payload)).toBe(true);
    expect(evaluateConditions([], payload)).toBe(true);
  });

  it('all conditions must pass (AND semantics)', () => {
    const pass: Condition[] = [
      { path: 'data.amount', op: 'gt', value: 1000 },
      { path: 'data.currency', op: 'eq', value: 'USD' },
    ];
    expect(evaluateConditions(pass, payload)).toBe(true);

    const oneFails: Condition[] = [
      { path: 'data.amount', op: 'gt', value: 1000 },
      { path: 'data.currency', op: 'eq', value: 'EUR' },
    ];
    expect(evaluateConditions(oneFails, payload)).toBe(false);
  });

  it('numeric compares coerce numbers (gt/gte/lt/lte)', () => {
    expect(evaluateConditions([{ path: 'data.amount', op: 'gt', value: 1000 }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'data.amount', op: 'gt', value: 5000 }], payload)).toBe(false);
    expect(evaluateConditions([{ path: 'data.amount', op: 'gte', value: 2000 }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'data.amount', op: 'lte', value: 2000 }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'data.amount', op: 'lt', value: 2000 }], payload)).toBe(false);
    // String value coerces to number.
    expect(evaluateConditions([{ path: 'data.amount', op: 'gt', value: '1000' }], payload)).toBe(true);
    // Non-numeric actual → false.
    expect(evaluateConditions([{ path: 'data.currency', op: 'gt', value: 1 }], payload)).toBe(false);
  });

  it('eq / neq are number/string tolerant', () => {
    expect(evaluateConditions([{ path: 'data.amount', op: 'eq', value: 2000 }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'data.amount', op: 'eq', value: '2000' }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'subject.type', op: 'eq', value: 'candidate' }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'subject.type', op: 'neq', value: 'lead' }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'subject.type', op: 'neq', value: 'candidate' }], payload)).toBe(false);
  });

  it('contains works for strings and arrays', () => {
    expect(evaluateConditions([{ path: 'data.title', op: 'contains', value: 'renewal' }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'data.title', op: 'contains', value: 'refund' }], payload)).toBe(false);
    expect(evaluateConditions([{ path: 'data.labels', op: 'contains', value: 'vip' }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'data.labels', op: 'contains', value: 'spam' }], payload)).toBe(false);
    // Non-string/array actual → false.
    expect(evaluateConditions([{ path: 'data.amount', op: 'contains', value: '20' }], payload)).toBe(false);
  });

  it('exists is truthy presence', () => {
    expect(evaluateConditions([{ path: 'data.paid', op: 'exists' }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'data.missing', op: 'exists' }], payload)).toBe(false);
    // count is 0 → falsy → does not "exist".
    expect(evaluateConditions([{ path: 'data.count', op: 'exists' }], payload)).toBe(false);
  });

  it('in checks membership in the value array', () => {
    expect(evaluateConditions([{ path: 'data.currency', op: 'in', value: ['USD', 'EUR'] }], payload)).toBe(true);
    expect(evaluateConditions([{ path: 'data.currency', op: 'in', value: ['GBP', 'EUR'] }], payload)).toBe(false);
    // Non-array value → false.
    expect(evaluateConditions([{ path: 'data.currency', op: 'in', value: 'USD' }], payload)).toBe(false);
  });

  it('missing paths and prototype-pollution keys resolve safely to undefined', () => {
    expect(evaluateConditions([{ path: 'data.nope', op: 'eq', value: 'x' }], payload)).toBe(false);
    expect(evaluateConditions([{ path: '__proto__.polluted', op: 'exists' }], payload)).toBe(false);
    expect(evaluateConditions([{ path: 'data.nope', op: 'exists' }], payload)).toBe(false);
  });
});
