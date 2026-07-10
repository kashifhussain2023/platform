import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { CircuitState } from '@vaep/types';
import {
  CircuitBreaker,
  CircuitOpenError,
  initialSnapshot,
  type CircuitOptions,
  type CircuitSnapshot,
} from './circuit-breaker';
import { countsTowardCircuit } from './error-classifier';
import { RESILIENCE_REDIS } from './redis.provider';

/**
 * CircuitBreakerRegistry — the per-connector breaker orchestrator (docs §9).
 *
 * State is stored in REDIS (key `vaep:cb:<connectorId>`) so a tripped breaker is
 * shared across workers/instances; if Redis is unavailable it transparently
 * falls back to an in-memory map (per-process). The pure state machine lives in
 * `CircuitBreaker`; this class only persists snapshots and exposes the egress
 * control surface:
 *   • `guard(id)` — throws `CircuitOpenError` when OPEN (the caller must NOT call
 *     the provider); otherwise allows the call (persisting OPEN→HALF_OPEN).
 *   • `recordSuccess/recordFailure(id)` — advance the machine after a call.
 *   • `run(id, fn)` — convenience wrapper (guard → fn → record) using
 *     `countsTowardCircuit` to decide which thrown errors trip the breaker.
 *
 * The mock skill executor path is never routed through here, so the offline test
 * suite is unaffected (breakers stay closed / uninvoked).
 */
@Injectable()
export class CircuitBreakerRegistry {
  private readonly logger = new Logger(CircuitBreakerRegistry.name);
  private readonly breaker: CircuitBreaker;
  private readonly opts: CircuitOptions;
  /** In-memory fallback snapshots (per-process) when Redis is down. */
  private readonly memory = new Map<string, CircuitSnapshot>();
  private readonly ttlMs: number;

  constructor(
    @Optional() @Inject(RESILIENCE_REDIS) private readonly redis: Redis | null,
    config: ConfigService,
  ) {
    this.opts = {
      failureThreshold: this.num(config, 'CIRCUIT_FAILURE_THRESHOLD', 5),
      cooldownMs: this.num(config, 'CIRCUIT_COOLDOWN_MS', 30_000),
    };
    this.breaker = new CircuitBreaker(this.opts);
    // Keep the snapshot around comfortably longer than one cooldown so a
    // recovering breaker isn't forgotten mid-cycle.
    this.ttlMs = Math.max(this.opts.cooldownMs * 10, 60_000);
  }

  /** Fast-fail guard: throws CircuitOpenError when OPEN (call must be skipped). */
  async guard(connectorId: string): Promise<void> {
    const snap = await this.read(connectorId);
    const decision = this.breaker.attempt(snap, Date.now());
    if (decision.changed) {
      await this.write(connectorId, decision.snapshot);
    }
    if (!decision.allowed) {
      throw new CircuitOpenError(connectorId);
    }
  }

  /** Record a successful call (HALF_OPEN → CLOSED; resets the failure counter). */
  async recordSuccess(connectorId: string): Promise<void> {
    const snap = await this.read(connectorId);
    // Nothing to persist for an already-healthy breaker.
    if (snap.state === 'CLOSED' && snap.failures === 0) {
      return;
    }
    await this.write(connectorId, this.breaker.onSuccess(snap));
  }

  /** Record a failing call (increments; trips to OPEN at the threshold). */
  async recordFailure(connectorId: string): Promise<void> {
    const snap = await this.read(connectorId);
    await this.write(connectorId, this.breaker.onFailure(snap, Date.now()));
  }

  /**
   * Convenience wrapper: guard, run, and record based on the outcome. A thrown
   * error is recorded as a failure only when it `countsTowardCircuit` (RETRYABLE
   * or auth); it is always rethrown so the caller can handle it.
   */
  async run<T>(connectorId: string, fn: () => Promise<T>): Promise<T> {
    await this.guard(connectorId);
    try {
      const result = await fn();
      await this.recordSuccess(connectorId);
      return result;
    } catch (err) {
      if (countsTowardCircuit(err)) {
        await this.recordFailure(connectorId);
      }
      throw err;
    }
  }

  /** Read-only reported state (reflects an elapsed cooldown as HALF_OPEN). */
  async getState(connectorId: string): Promise<CircuitState> {
    const snap = await this.read(connectorId);
    return this.breaker.observedState(snap, Date.now());
  }

  // --- Persistence (Redis with in-memory fallback) -------------------------

  private key(connectorId: string): string {
    return `vaep:cb:${connectorId}`;
  }

  private async read(connectorId: string): Promise<CircuitSnapshot> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(this.key(connectorId));
        if (raw) {
          return JSON.parse(raw) as CircuitSnapshot;
        }
        return initialSnapshot();
      } catch (err) {
        this.logger.debug(
          `redis breaker read failed, using memory: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return this.memory.get(connectorId) ?? initialSnapshot();
  }

  private async write(
    connectorId: string,
    snapshot: CircuitSnapshot,
  ): Promise<void> {
    this.memory.set(connectorId, snapshot);
    if (this.redis) {
      try {
        await this.redis.set(
          this.key(connectorId),
          JSON.stringify(snapshot),
          'PX',
          this.ttlMs,
        );
      } catch (err) {
        this.logger.debug(
          `redis breaker write failed (kept in memory): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private num(config: ConfigService, key: string, fallback: number): number {
    const raw = config.get<string>(key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }
}
