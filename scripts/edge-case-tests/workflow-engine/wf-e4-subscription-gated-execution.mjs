#!/usr/bin/env node
/**
 * WF-E4 — a workflow tries to run while the company's subscription is
 * PAST_DUE. docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: the run fails IMMEDIATELY (before any node executes) with a clear
 * billing message, instead of consuming paid LLM/tool calls indefinitely.
 * There's no public "make my own subscription past due" API (that's a real
 * Stripe/webhook event) — arranged via one direct SQL UPDATE, verified
 * entirely through the real API/engine behavior.
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, dbExec, closePrompt,
} from '../lib/harness.mjs';

section('WF-E4: workflow execution blocked on PAST_DUE subscription');

const { client, companyId } = await freshCompany('WF-E4');

const wf = await createWorkflow(client, {
  name: 'WF-E4 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'n1', type: 'NOTIFY', config: { message: 'should never run' } },
    ],
    edges: [{ from: 't1', to: 'n1' }],
  },
});

info('Forcing the subscription to PAST_DUE (test-setup only)...');
await dbExec(`update "Subscription" set status='PAST_DUE' where "companyId"='${companyId}';`);

const run = await runWorkflow(client, wf.id, {});
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);

assert(finished.status === 'FAILED', 'run FAILS immediately, no node executes', finished.status);
assert(
  (finished.error ?? '').toLowerCase().includes('past due'),
  'error clearly names the billing reason',
  finished.error,
);
assert((finished.steps ?? []).length === 0, 'zero steps were recorded — the NOTIFY node never ran', finished.steps?.length);

summary();
closePrompt();
