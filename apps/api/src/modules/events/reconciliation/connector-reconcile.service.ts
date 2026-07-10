import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InstalledSkill } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CONNECTOR_RECONCILE_BATCH } from '../events.constants';

/** Outcome of reconciling one connector. */
export interface ReconcileResult {
  connectorId: string;
  provider: string;
  /** How many missed events were caught up (0 for the offline no-op skeleton). */
  reconciled: number;
  /** True when nothing was done (offline / no real provider poller yet). */
  noop: boolean;
}

/**
 * ConnectorReconcileService — the SKELETON of the reconciliation sweep (docs
 * §2.3): the belt-and-suspenders that heals events missed by webhooks (endpoint
 * down, provider incident). It is a per-provider, cursor-based CATCH-UP poll.
 *
 * [TARGET] real path (needs live creds, per provider):
 *   1. read the connector's stored sync cursor (Gmail historyId / Graph deltaLink
 *      / GitHub `since` / Stripe event id, …);
 *   2. call the provider's "what changed since cursor?" list endpoint;
 *   3. for each change, persist a RawEvent + enqueue the EXISTING `event-normalize`
 *      pipeline (which runs the provider mapper `mapRawEvent` → CanonicalEvent →
 *      WorkflowsService.fireEvent) — reusing all of Unit A's idempotent machinery;
 *   4. advance + persist the cursor.
 *
 * No provider poller is implemented yet, so `reconcile` is a safe no-op; the
 * scheduled sweep is additionally a no-op offline (SKILL_EXECUTOR=mock).
 */
@Injectable()
export class ConnectorReconcileService {
  private readonly logger = new Logger(ConnectorReconcileService.name);
  /** Real polling only in live executor mode; offline → no-op. */
  private readonly liveReconcile: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const mode = (config.get<string>('SKILL_EXECUTOR') ?? 'mock').toLowerCase();
    this.liveReconcile = mode === 'real' || mode === 'auto';
  }

  /**
   * Reconcile one connector. No-op today: offline, or no per-provider poller is
   * registered (the real cursor poll is [TARGET]).
   */
  async reconcile(connector: InstalledSkill): Promise<ReconcileResult> {
    const provider = connector.skillKey;
    if (!this.liveReconcile || !this.hasPoller(provider)) {
      return { connectorId: connector.id, provider, reconciled: 0, noop: true };
    }
    // [TARGET] real cursor-based catch-up poll wired into the event-normalize
    // pipeline (see class doc). Unreachable until a provider poller exists.
    return { connectorId: connector.id, provider, reconciled: 0, noop: true };
  }

  /**
   * Scheduled sweep: reconcile every live (CONNECTED/DEGRADED) connector, batched.
   * A NO-OP offline so it is safe with no live creds. Per-connector failures are
   * isolated (one bad poll never aborts the sweep).
   */
  async sweep(): Promise<{ reconciled: number }> {
    if (!this.liveReconcile) {
      this.logger.debug('Reconcile sweep skipped (offline / SKILL_EXECUTOR=mock)');
      return { reconciled: 0 };
    }
    const connectors = await this.prisma.installedSkill.findMany({
      where: { connectionStatus: { in: ['CONNECTED', 'DEGRADED'] }, enabled: true },
      take: CONNECTOR_RECONCILE_BATCH,
    });
    let reconciled = 0;
    for (const connector of connectors) {
      try {
        const result = await this.reconcile(connector);
        reconciled += result.reconciled;
      } catch (err) {
        this.logger.error(
          `Reconcile failed for connector ${connector.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { reconciled };
  }

  /** Whether a real cursor poller exists for this provider ([TARGET]: none yet). */
  private hasPoller(_provider: string): boolean {
    return false;
  }
}
