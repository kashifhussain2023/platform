#!/usr/bin/env node
/**
 * WF-D1 — a cyclic graph (an edge loops back to an earlier node).
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: bounded by MAX_WORKFLOW_NODES (50) — the run FAILS with a clear
 * "exceeded max node count" error instead of hanging the worker forever.
 * NOTE: this run legitimately takes a few seconds (it visits ~50 nodes).
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-D1: cyclic graph (n1 -> n2 -> n3 -> n1 -> ...)');

const { client } = await freshCompany('WF-D1');

const wf = await createWorkflow(client, {
  name: 'WF-D1 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'n1', type: 'NOTIFY', config: { message: 'loop 1' } },
      { id: 'n2', type: 'NOTIFY', config: { message: 'loop 2' } },
      { id: 'n3', type: 'NOTIFY', config: { message: 'loop 3' } },
    ],
    edges: [
      { from: 't1', to: 'n1' },
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n1' }, // <-- cycle back
    ],
  },
});

info('Running (bounded — expect this to take a few seconds while it visits ~50 nodes)...');
const run = await runWorkflow(client, wf.id, {});
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED'], { tries: 80, delayMs: 500 });

assert(finished.status === 'FAILED', 'run FAILS (bounded), never hangs forever', finished.status);
assert(
  (finished.error ?? '').toLowerCase().includes('exceeded max node count'),
  'error names the max-node-count guard',
  finished.error,
);

summary();
closePrompt();
