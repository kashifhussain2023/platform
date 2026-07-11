#!/usr/bin/env node
/**
 * WF-B2 — two concurrent decisions (approve/reject) on the SAME approval
 * request. docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: exactly ONE decision wins (atomic claim, fixed this session);
 * everyone else gets 409, and the run resolves exactly once.
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, getRun, closePrompt, BASE,
} from '../lib/harness.mjs';

section('WF-B2: concurrent approve/reject race');

const { client } = await freshCompany('WF-B2');

const wf = await createWorkflow(client, {
  name: 'WF-B2 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'ap1', type: 'APPROVAL', config: { message: 'approve?' } },
      { id: 'n1', type: 'NOTIFY', config: { message: 'done' } },
    ],
    edges: [{ from: 't1', to: 'ap1' }, { from: 'ap1', to: 'n1' }],
  },
});
const run = await runWorkflow(client, wf.id, {});
await waitForRunStatus(client, run.id, ['WAITING']);

const approvals = await client.get('/approvals');
const approval = approvals.find((a) => a.workflowRunId === run.id);
info(`Firing 5 CONCURRENT decisions (mixed approve/reject) on approval ${approval.id}...`);

const token = client.getToken();
const results = await Promise.all(
  [1, 2, 3, 4, 5].map((i) => {
    const action = i % 2 === 0 ? 'reject' : 'approve';
    return fetch(`${BASE}/approvals/${approval.id}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then((r) => ({ i, action, status: r.status }));
  }),
);
results.forEach((r) => info(`  req${r.i} (${r.action}): HTTP ${r.status}`));

const succeeded = results.filter((r) => r.status === 201 || r.status === 200);
const conflicted = results.filter((r) => r.status === 409);
assert(succeeded.length === 1, 'exactly 1 decision succeeded', `${succeeded.length} succeeded`);
assert(conflicted.length === 4, 'the other 4 correctly got 409 Conflict', `${conflicted.length} conflicted`);

// The winning decision's resume/cancel is enqueued async (BullMQ) — wait for
// it to actually land instead of checking immediately.
const finalRun = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);
assert(
  finalRun.status === 'COMPLETED' || finalRun.status === 'FAILED',
  'run resolved exactly once (not stuck WAITING, not double-processed)',
  finalRun.status,
);

summary();
closePrompt();
