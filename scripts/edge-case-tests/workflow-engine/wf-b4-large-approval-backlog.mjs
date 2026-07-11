#!/usr/bin/env node
/**
 * WF-B4 — large PENDING approval backlog (performance, not correctness).
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Informational only: creates a batch of PENDING approvals and times the
 * /approvals list fetch. There is no documented perf target to pass/fail
 * against — this just gives you a real number to eyeball.
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, runWorkflow,
  poll, closePrompt,
} from '../lib/harness.mjs';

const N = Number(process.argv[2] || 30);
section(`WF-B4: ${N} PENDING approvals — list-fetch timing (informational)`);

const { client } = await freshCompany('WF-B4');

const wf = await createWorkflow(client, {
  name: 'WF-B4 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'ap1', type: 'APPROVAL', config: { message: 'approve?' } },
    ],
    edges: [{ from: 't1', to: 'ap1' }],
  },
});

info(`Firing ${N} runs (each pauses at Approval)...`);
for (let i = 0; i < N; i += 1) {
  await runWorkflow(client, wf.id, { i });
}

// Each run's walk to the Approval node is processed ASYNC (BullMQ) — poll
// until all N have actually landed as PENDING approvals before timing the
// list fetch (a tight immediate check would undercount, as it did once here).
info('Waiting for all runs to reach WAITING (async queue processing)...');
await poll(
  async () => {
    const rows = await client.get('/approvals?status=PENDING');
    return rows.length >= N ? rows : null;
  },
  { label: `${N} PENDING approvals to appear`, tries: 60, delayMs: 500 },
);

const start = Date.now();
const approvals = await client.get('/approvals?status=PENDING');
const ms = Date.now() - start;

assert(approvals.length >= N, `at least ${N} PENDING approvals returned`, `${approvals.length} returned`);
info(`GET /approvals?status=PENDING took ${ms}ms for ${approvals.length} rows.`);
info('No pass/fail threshold — re-run with a larger N (e.g. `node wf-b4-large-approval-backlog.mjs 300`) if you want to see how this scales.');

summary();
closePrompt();
