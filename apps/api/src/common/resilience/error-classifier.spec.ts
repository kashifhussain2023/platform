import {
  classify,
  countsTowardCircuit,
  httpStatusOf,
  isAuthError,
} from './error-classifier';

describe('error-classifier', () => {
  describe('classify', () => {
    it('treats HTTP 429 as RETRYABLE', () => {
      expect(classify({ status: 429 })).toBe('RETRYABLE');
      expect(classify(429)).toBe('RETRYABLE');
      expect(classify('Gmail API error (429): quota exceeded')).toBe('RETRYABLE');
    });

    it('treats HTTP 5xx as RETRYABLE', () => {
      expect(classify({ status: 500 })).toBe('RETRYABLE');
      expect(classify({ statusCode: 502 })).toBe('RETRYABLE');
      expect(classify({ response: { status: 503 } })).toBe('RETRYABLE');
      expect(classify('Slack webhook failed (503): unavailable')).toBe(
        'RETRYABLE',
      );
    });

    it('treats network / timeout errors as RETRYABLE', () => {
      expect(classify({ code: 'ECONNRESET' })).toBe('RETRYABLE');
      expect(classify({ code: 'ETIMEDOUT' })).toBe('RETRYABLE');
      expect(classify({ name: 'AbortError' })).toBe('RETRYABLE');
      expect(classify(new Error('socket hang up'))).toBe('RETRYABLE');
      expect(classify(new Error('fetch failed'))).toBe('RETRYABLE');
      expect(classify(new Error('request timed out'))).toBe('RETRYABLE');
    });

    it('treats HTTP 4xx (400/401/403/404/422) as TERMINAL', () => {
      expect(classify({ status: 400 })).toBe('TERMINAL');
      expect(classify({ status: 401 })).toBe('TERMINAL');
      expect(classify({ status: 403 })).toBe('TERMINAL');
      expect(classify({ status: 404 })).toBe('TERMINAL');
      expect(classify({ status: 422 })).toBe('TERMINAL');
      expect(classify('Gmail API error (401): invalid credentials')).toBe(
        'TERMINAL',
      );
    });

    it('treats validation / auth message errors as TERMINAL', () => {
      expect(classify(new Error('Validation failed: name is required'))).toBe(
        'TERMINAL',
      );
      expect(classify(new Error('Unauthorized'))).toBe('TERMINAL');
      expect(classify(new Error('invalid_grant'))).toBe('TERMINAL');
    });

    it('defaults an unknown error to RETRYABLE (bounded attempts + DLQ safety net)', () => {
      expect(classify(new Error('something weird happened'))).toBe('RETRYABLE');
      expect(classify(undefined)).toBe('RETRYABLE');
    });
  });

  describe('httpStatusOf', () => {
    it('reads explicit and embedded statuses, ignores non-status numbers', () => {
      expect(httpStatusOf({ status: 500 })).toBe(500);
      expect(httpStatusOf({ response: { status: 429 } })).toBe(429);
      expect(httpStatusOf('boom (404) not found')).toBe(404);
      expect(httpStatusOf('HTTP 503 service unavailable')).toBe(503);
      expect(httpStatusOf(new Error('no status here'))).toBeNull();
    });
  });

  describe('isAuthError', () => {
    it('is true only for 401/403 (or auth keywords without a status)', () => {
      expect(isAuthError({ status: 401 })).toBe(true);
      expect(isAuthError({ status: 403 })).toBe(true);
      expect(isAuthError({ status: 500 })).toBe(false);
      expect(isAuthError({ status: 400 })).toBe(false);
      expect(isAuthError(new Error('Forbidden'))).toBe(true);
      expect(isAuthError(new Error('network timeout'))).toBe(false);
    });
  });

  describe('countsTowardCircuit', () => {
    it('counts RETRYABLE and auth-TERMINAL, but not plain validation errors', () => {
      expect(countsTowardCircuit({ status: 429 })).toBe(true); // retryable
      expect(countsTowardCircuit({ status: 503 })).toBe(true); // retryable
      expect(countsTowardCircuit({ code: 'ECONNRESET' })).toBe(true); // network
      expect(countsTowardCircuit({ status: 401 })).toBe(true); // auth terminal
      expect(countsTowardCircuit({ status: 403 })).toBe(true); // auth terminal
      expect(countsTowardCircuit({ status: 400 })).toBe(false); // validation
      expect(countsTowardCircuit({ status: 422 })).toBe(false); // validation
    });
  });
});
