#!/usr/bin/env node
/**
 * WF-A2 — AI_STEP returns non-numeric text into a numeric CONDITION.
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: a CONDITION comparing a garbled/non-numeric value with gt/lt now
 * FAILS THE RUN LOUDLY (fixed this session) instead of silently coercing to
 * NaN/0 and picking the wrong branch. Fully automated — no user input needed.
 */
import {
  section, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-A2: non-numeric CONDITION operand');

const { client } = await freshCompany('WF-A2');

const wf = await createWorkflow(client, {
  name: 'WF-A2 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'c1', type: 'CONDITION', config: { left: '{{trigger.score}}', op: 'gt', right: '79' } },
      { id: 'n1', type: 'NOTIFY', config: { message: 'should never reach here' } },
    ],
    edges: [
      { from: 't1', to: 'c1' },
      { from: 'c1', to: 'n1', branch: 'true' },
    ],
  },
});

const run = await runWorkflow(client, wf.id, { score: 'around 85' });
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);

assert(finished.status === 'FAILED', 'run status is FAILED (not silently COMPLETED)', finished.status);
assert(
  (finished.error ?? '').includes('CONDITION expected a number'),
  'error message names the bad operand',
  finished.error,
);

summary();
closePrompt();
