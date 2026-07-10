/**
 * Per-connector circuit breaker (egress, docs §9) — the PURE state machine.
 *
 * CLOSED ──≥threshold consecutive failures──▶ OPEN
 * OPEN   ──cooldown elapsed──▶ HALF_OPEN (one probe allowed)
 * HALF_OPEN ──probe success──▶ CLOSED   |   ──probe failure──▶ OPEN
 *
 * This class holds NO state: every method takes a snapshot + `now` and returns a
 * new snapshot (or a decision). That keeps it trivially unit-testable and lets
 * the registry persist snapshots to Redis (shared across workers) with an
 * in-memory fallback. `CircuitState` is the shared type from @vaep/types.
 */
import type { CircuitState } from '@vaep/types';

/** Persisted breaker state for one connector. */
export interface CircuitSnapshot {
  state: CircuitState;
  /** Consecutive failures while CLOSED (resets on success). */
  failures: number;
  /** Epoch ms the breaker last opened (drives the cooldown), null when not OPEN. */
  openedAt: number | null;
}

export interface CircuitOptions {
  /** Consecutive failures that trip CLOSED → OPEN. */
  failureThreshold: number;
  /** How long (ms) the breaker stays OPEN before allowing a HALF_OPEN probe. */
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT_OPTIONS: CircuitOptions = {
  failureThreshold: 5,
  cooldownMs: 30_000,
};

/** Thrown by the registry when a call is fast-failed because the breaker is OPEN. */
export class CircuitOpenError extends Error {
  constructor(public readonly connectorId: string) {
    super(`Circuit is open for connector ${connectorId}`);
    this.name = 'CircuitOpenError';
  }
}

/** A fresh, healthy (CLOSED) snapshot. */
export function initialSnapshot(): CircuitSnapshot {
  return { state: 'CLOSED', failures: 0, openedAt: null };
}

/** Decision returned by {@link CircuitBreaker.attempt}. */
export interface AttemptDecision {
  /** Whether the call may proceed. */
  allowed: boolean;
  /** The (possibly transitioned) snapshot to persist when `changed` is true. */
  snapshot: CircuitSnapshot;
  /** True when `attempt` transitioned the state (OPEN → HALF_OPEN) and must persist. */
  changed: boolean;
}

export class CircuitBreaker {
  constructor(
    private readonly opts: CircuitOptions = DEFAULT_CIRCUIT_OPTIONS,
  ) {}

  /**
   * Decide whether a call may proceed given the current snapshot. When OPEN and
   * the cooldown has elapsed, transitions to HALF_OPEN and allows a single probe
   * (caller persists the returned snapshot when `changed`).
   */
  attempt(snap: CircuitSnapshot, now: number): AttemptDecision {
    switch (snap.state) {
      case 'OPEN': {
        const elapsed = snap.openedAt != null && now - snap.openedAt >= this.opts.cooldownMs;
        if (elapsed) {
          return {
            allowed: true,
            snapshot: { ...snap, state: 'HALF_OPEN' },
            changed: true,
          };
        }
        return { allowed: false, snapshot: snap, changed: false };
      }
      case 'HALF_OPEN':
        // A probe is in flight / allowed; success or failure resolves the state.
        return { allowed: true, snapshot: snap, changed: false };
      case 'CLOSED':
      default:
        return { allowed: true, snapshot: snap, changed: false };
    }
  }

  /** Record a success: HALF_OPEN probe → CLOSED; CLOSED → reset failure count. */
  onSuccess(_snap: CircuitSnapshot): CircuitSnapshot {
    return { state: 'CLOSED', failures: 0, openedAt: null };
  }

  /**
   * Record a failure. From HALF_OPEN a failed probe re-opens immediately. From
   * CLOSED, the failure counter increments and trips to OPEN at the threshold.
   */
  onFailure(snap: CircuitSnapshot, now: number): CircuitSnapshot {
    if (snap.state === 'HALF_OPEN') {
      return { state: 'OPEN', failures: snap.failures + 1, openedAt: now };
    }
    const failures = snap.failures + 1;
    if (failures >= this.opts.failureThreshold) {
      return { state: 'OPEN', failures, openedAt: now };
    }
    return { state: 'CLOSED', failures, openedAt: null };
  }

  /**
   * The state a snapshot should REPORT right now, reflecting an elapsed cooldown
   * (OPEN → HALF_OPEN) without mutating anything. For read-only surfaces.
   */
  observedState(snap: CircuitSnapshot, now: number): CircuitState {
    if (
      snap.state === 'OPEN' &&
      snap.openedAt != null &&
      now - snap.openedAt >= this.opts.cooldownMs
    ) {
      return 'HALF_OPEN';
    }
    return snap.state;
  }
}
