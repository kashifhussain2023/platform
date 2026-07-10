import type { Condition, EventConditionOp } from '@vaep/types';
import { lookup } from './template';

/**
 * Pure evaluator for the EVENT condition DSL (docs §5.2 — "richer filters").
 *
 * Given a workflow's `triggerConfig.conditions` and a fired event `payload`
 * (`{ eventId, subject, data }`), returns true iff EVERY condition passes. An
 * empty/absent list is always true, so existing EVENT workflows (no conditions)
 * fire exactly as before (back-compat).
 *
 * `path` is resolved with the same safe, prototype-pollution-guarded dotted
 * lookup the template resolver uses (NO eval). Operator semantics:
 *   eq/neq   — equality, number/string tolerant
 *   gt/gte/lt/lte — numeric compare (both sides coerced to Number; NaN → false)
 *   contains — substring (string) or membership (array), value tolerant
 *   exists   — truthy presence of the resolved value (no `value` needed)
 *   in       — the resolved value is a member of the `value` array
 */
export function evaluateConditions(
  conditions: Condition[] | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return true;
  }
  return conditions.every((condition) => evaluateOne(condition, payload));
}

/** Evaluate a single predicate against the payload. */
function evaluateOne(
  condition: Condition,
  payload: Record<string, unknown>,
): boolean {
  const { path, op, value } = condition;
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  const actual = lookup(payload, path);

  switch (op) {
    case 'exists':
      // Truthy presence: 0 / '' / false / null / undefined → does not "exist".
      return Boolean(actual);
    case 'eq':
      return looseEq(actual, value);
    case 'neq':
      return !looseEq(actual, value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return numericCompare(op, actual, value);
    case 'contains':
      return containsOp(actual, value);
    case 'in':
      return inOp(actual, value);
    default:
      // Unknown operator (shape validation should reject before we get here).
      return false;
  }
}

/** Number/string-tolerant equality (JSON configs may type a value as either). */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      return na === nb;
    }
  }
  return String(a) === String(b);
}

/** gt/gte/lt/lte with both operands coerced to Number (non-finite → false). */
function numericCompare(
  op: Extract<EventConditionOp, 'gt' | 'gte' | 'lt' | 'lte'>,
  actual: unknown,
  value: unknown,
): boolean {
  const a = Number(actual);
  const b = Number(value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  switch (op) {
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    default:
      return false;
  }
}

/** contains: substring for strings, membership for arrays. */
function containsOp(actual: unknown, value: unknown): boolean {
  if (typeof actual === 'string') {
    return actual.includes(String(value));
  }
  if (Array.isArray(actual)) {
    return actual.some((item) => looseEq(item, value));
  }
  return false;
}

/** in: the resolved value is a member of the `value` array. */
function inOp(actual: unknown, value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((item) => looseEq(item, actual));
}
