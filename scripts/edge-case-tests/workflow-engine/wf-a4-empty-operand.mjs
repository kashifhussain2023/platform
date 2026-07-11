#!/usr/bin/env node
/**
 * WF-A4 — empty `right` operand with `gt` (`Number('')` is 0 in JS, not NaN —
 * a naive check would miss this). docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: an empty numeric operand FAILS the run instead of silently becoming
 * "score > 0" (which is true for almost any positive score).
 */
import {
  section, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-A4: empty CONDITION operand');

const { client } = await freshCompany('WF-A4');

const wf = await createWorkflow(client, {
  name: 'WF-A4 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'c1', type: 'CONDITION', config: { left: '{{trigger.score}}', op: 'gt', right: '' } },
      { id: 'n1', type: 'NOTIFY', config: { message: 'should never reach here' } },
    ],
    edges: [
      { from: 't1', to: 'c1' },
      { from: 'c1', to: 'n1', branch: 'true' },
    ],
  },
});

const run = await runWorkflow(client, wf.id, { score: '5' });
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);

assert(finished.status === 'FAILED', 'run status is FAILED (empty operand rejected, not treated as 0)', finished.status);
assert((finished.error ?? '').includes('CONDITION expected a number'), 'error names the bad operand', finished.error);

summary();
closePrompt();
