#!/usr/bin/env node
/**
 * WF-A5 — `contains` op case-sensitivity. docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Not a bug — a documented, observed behavior: `contains` is a plain
 * String.includes(), case-sensitive. This script just demonstrates it so you
 * can see the actual behavior rather than take the doc's word for it.
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-A5: contains-op case sensitivity (documented behavior, not a bug)');

const { client } = await freshCompany('WF-A5');

const wf = await createWorkflow(client, {
  name: 'WF-A5 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'c1', type: 'CONDITION', config: { left: '{{trigger.body}}', op: 'contains', right: 'Node.js' } },
      { id: 'yes', type: 'NOTIFY', config: { message: 'matched' } },
      { id: 'no', type: 'NOTIFY', config: { message: 'did not match' } },
    ],
    edges: [
      { from: 't1', to: 'c1' },
      { from: 'c1', to: 'yes', branch: 'true' },
      { from: 'c1', to: 'no', branch: 'false' },
    ],
  },
});

info('Sending body text with lowercase "node.js" (exact case differs from the condition\'s "Node.js")...');
const run = await runWorkflow(client, wf.id, { body: '5 years of node.js backend experience' });
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);

assert(finished.status === 'COMPLETED', 'run completes normally either way', finished.status);
info(`Case mismatch means it took the FALSE branch — confirm the last step in the run log is "no" (not "yes").`);
info(`Run id: ${run.id} — check /workflows/${wf.id} (or GET /workflows/runs/${run.id}) to see which NOTIFY node executed.`);

summary();
closePrompt();
