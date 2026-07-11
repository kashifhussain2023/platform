#!/usr/bin/env node
/**
 * WF-D4 — a WAIT node requesting a duration over MAX_WAIT_MS (10s).
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: silently CLAMPED to the cap (not literally waited), and the step's
 * recorded output shows both the requested and actual (capped) duration for
 * auditability. This run takes ~10s (the capped wait itself).
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-D4: WAIT node over the cap');

const { client } = await freshCompany('WF-D4');

const wf = await createWorkflow(client, {
  name: 'WF-D4 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'w1', type: 'WAIT', config: { durationMs: 999_999 } }, // way over the 10s cap
    ],
    edges: [{ from: 't1', to: 'w1' }],
  },
});

info('Running (expect ~10s while the capped wait elapses)...');
const run = await runWorkflow(client, wf.id, {});
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED'], { tries: 40, delayMs: 500 });

assert(finished.status === 'COMPLETED', 'run completes (does not hang for the requested duration)', finished.status);
const waitStep = finished.steps?.find((s) => s.nodeId === 'w1');
assert(waitStep?.output?.requestedMs === 999_999, 'output records the ORIGINAL requested duration', waitStep?.output?.requestedMs);
assert(waitStep?.output?.waitedMs === 10_000, 'output records the ACTUAL (capped) waited duration', waitStep?.output?.waitedMs);

summary();
closePrompt();
