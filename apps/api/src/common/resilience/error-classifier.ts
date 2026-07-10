/**
 * Error classification for retry / circuit-breaker decisions (docs §4.4, §9).
 *
 * Pure, dependency-free, and unit-tested. Two consumers rely on it:
 *   • Queue retry decisions — a TERMINAL error is wrapped in a BullMQ
 *     `UnrecoverableError` so it goes straight to the DLQ (no retry storm),
 *     while a RETRYABLE error uses the queue's bounded backoff.
 *   • Egress (skill tool calls) — RETRYABLE failures (and TERMINAL *auth*
 *     failures) count toward tripping the per-connector circuit breaker.
 *
 * RETRYABLE = transient: network/timeout (ECONNRESET, …), HTTP 429, HTTP 5xx.
 * TERMINAL  = permanent for this input: HTTP 4xx (esp. 400/401/403/404/422),
 *             validation, auth. Retrying a 4xx just burns quota.
 */

export type RetryClassification = 'RETRYABLE' | 'TERMINAL';

/** Node/OS socket error codes that indicate a transient network failure. */
const RETRYABLE_NET_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ESOCKETTIMEDOUT',
  'EHOSTDOWN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Error names that mean "the call timed out / was aborted" → transient. */
const RETRYABLE_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'FetchError',
  'ConnectTimeoutError',
]);

/** Extract a string message from any thrown value (or a raw string). */
function messageOf(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') {
      return m;
    }
  }
  return String(error ?? '');
}

/** Node error `.code` (socket codes) if present. */
function codeOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const c = (error as { code?: unknown }).code;
    if (typeof c === 'string') {
      return c;
    }
  }
  return '';
}

/** Error/exception name if present. */
function nameOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const n = (error as { name?: unknown }).name;
    if (typeof n === 'string') {
      return n;
    }
  }
  return '';
}

/**
 * Best-effort HTTP status extraction: a numeric error, an explicit
 * `.status`/`.statusCode`/`.response.status` field, or a status embedded in the
 * message ("(429)", "HTTP 503", "status: 500", "code 401"). Returns null when
 * no plausible 1xx–5xx status is found.
 */
export function httpStatusOf(error: unknown): number | null {
  if (typeof error === 'number') {
    return error >= 100 && error <= 599 ? error : null;
  }
  if (error && typeof error === 'object') {
    const e = error as {
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown; statusCode?: unknown };
    };
    const direct =
      e.status ?? e.statusCode ?? e.response?.status ?? e.response?.statusCode;
    if (typeof direct === 'number' && direct >= 100 && direct <= 599) {
      return direct;
    }
  }
  const msg = messageOf(error);
  // "(429)" or "[500]"
  const paren = msg.match(/[([](\d{3})[)\]]/);
  if (paren) {
    const n = Number(paren[1]);
    if (n >= 100 && n <= 599) {
      return n;
    }
  }
  // "HTTP 503", "status: 500", "status code 429", "code 401", "error 404"
  const labelled = msg.match(
    /\b(?:http|status(?:\s*code)?|code|error)\s*[:=]?\s*(\d{3})\b/i,
  );
  if (labelled) {
    const n = Number(labelled[1]);
    if (n >= 100 && n <= 599) {
      return n;
    }
  }
  return null;
}

const RATE_LIMIT_RE = /\b(rate[\s_-]?limit|too many requests|rate_limited|429)\b/i;
const NETWORK_RE =
  /\b(network|timed?\s*out|timeout|socket hang up|fetch failed|connection (?:reset|refused|closed)|econnreset|etimedout|enotfound)\b/i;
const AUTH_RE =
  /\b(unauthor[ie]zed|forbidden|invalid[\s_-]?grant|invalid[\s_-]?token|authentication|invalid api key|access denied|permission denied|401|403)\b/i;
const VALIDATION_RE =
  /\b(validation|invalid|malformed|bad request|not found|unprocessable|missing required|400|404|422)\b/i;

/** True when the error is an authentication/authorization failure (401/403). */
export function isAuthError(error: unknown): boolean {
  const status = httpStatusOf(error);
  if (status === 401 || status === 403) {
    return true;
  }
  if (status != null) {
    return false; // a definite non-auth status wins over keyword guessing
  }
  return AUTH_RE.test(messageOf(error));
}

/**
 * Classify an error as RETRYABLE or TERMINAL. Accepts an Error, a plain object
 * with `status`/`code`, a raw HTTP status number, or a message string.
 */
export function classify(error: unknown): RetryClassification {
  const status = httpStatusOf(error);
  if (status != null) {
    if (status === 429 || status === 408) {
      return 'RETRYABLE';
    }
    if (status >= 500) {
      return 'RETRYABLE';
    }
    if (status >= 400) {
      return 'TERMINAL';
    }
    // 1xx–3xx as an "error" is unusual — treat as transient.
    return 'RETRYABLE';
  }

  const code = codeOf(error).toUpperCase();
  if (code && RETRYABLE_NET_CODES.has(code)) {
    return 'RETRYABLE';
  }
  if (RETRYABLE_NAMES.has(nameOf(error))) {
    return 'RETRYABLE';
  }

  const msg = messageOf(error);
  if (RATE_LIMIT_RE.test(msg) || NETWORK_RE.test(msg)) {
    return 'RETRYABLE';
  }
  if (AUTH_RE.test(msg) || VALIDATION_RE.test(msg)) {
    return 'TERMINAL';
  }

  // Unknown/ambiguous: prefer RETRYABLE — bounded attempts + the DLQ are the
  // safety net ("fail loud, retry smart, never lose", docs §0/§4.4).
  return 'RETRYABLE';
}

/**
 * Whether a failure should count toward tripping the per-connector circuit
 * breaker (docs §9). RETRYABLE failures count (provider is unhealthy); TERMINAL
 * *auth* failures also count (revoked/expired creds ⇒ the connector is unusable).
 * A plain TERMINAL validation error (400/404/422) does NOT — it's the caller's
 * bad input, not the provider failing, so it must not open the breaker.
 */
export function countsTowardCircuit(error: unknown): boolean {
  if (classify(error) === 'RETRYABLE') {
    return true;
  }
  return isAuthError(error);
}
