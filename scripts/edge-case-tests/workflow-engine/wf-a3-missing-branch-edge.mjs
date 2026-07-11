#!/usr/bin/env node
/**
 * WF-A3 — CONDITION true but no matching branch edge exists (only a [false]
 * edge is wired). docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: the run FAILS LOUDLY instead of silently following an arbitrary edge.
 */
import {
  section, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-A3: CONDITION true with only a [false] edge wired');

const { client } = await freshCompany('WF-A3');

const wf = await createWorkflow(client, {
  name: 'WF-A3 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'c1', type: 'CONDITION', config: { left: '100', op: 'gt', right: '79' } }, // always true
      { id: 'n1', type: 'NOTIFY', config: { message: 'reject path' } },
    ],
    edges: [
      { from: 't1', to: 'c1' },
      { from: 'c1', to: 'n1', branch: 'false' }, // ONLY a false edge exists
    ],
  },
});

const run = await runWorkflow(client, wf.id, {});
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);

assert(finished.status === 'FAILED', 'run status is FAILED (not silently following the wrong edge)', finished.status);
assert(
  (finished.error ?? '').includes('no outgoing edge has branch="true"'),
  'error names the missing branch',
  finished.error,
);

summary();
closePrompt();
