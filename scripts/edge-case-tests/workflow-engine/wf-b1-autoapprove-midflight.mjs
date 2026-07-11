#!/usr/bin/env node
/**
 * WF-B1 — toggling `autoApprove` ON while a run is ALREADY WAITING at that
 * Approval node. docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Question this answers: does flipping the toggle retroactively unblock an
 * already-paused run, or does it only affect the NEXT run to reach that node?
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, patchWorkflow,
  runWorkflow, getRun, waitForRunStatus, sleep, closePrompt,
} from '../lib/harness.mjs';

section('WF-B1: autoApprove toggled mid-flight (run already WAITING)');

const { client } = await freshCompany('WF-B1');

const wf = await createWorkflow(client, {
  name: 'WF-B1 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'ap1', type: 'APPROVAL', config: { message: 'approve?' } }, // autoApprove OFF
      { id: 'n1', type: 'NOTIFY', config: { message: 'resumed' } },
    ],
    edges: [{ from: 't1', to: 'ap1' }, { from: 'ap1', to: 'n1' }],
  },
});

info('Run #1: starting with autoApprove OFF...');
const run1 = await runWorkflow(client, wf.id, {});
await waitForRunStatus(client, run1.id, ['WAITING']);
info('Run #1 is now WAITING at the Approval node (a PENDING ApprovalRequest exists).');

info('Flipping the workflow definition to autoApprove:true, WITHOUT touching run #1...');
await patchWorkflow(client, wf.id, {
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'ap1', type: 'APPROVAL', config: { message: 'approve?', autoApprove: true } },
      { id: 'n1', type: 'NOTIFY', config: { message: 'resumed' } },
    ],
    edges: [{ from: 't1', to: 'ap1' }, { from: 'ap1', to: 'n1' }],
  },
});

await sleep(2000);
const run1After = await getRun(client, run1.id);
assert(
  run1After.status === 'WAITING',
  'run #1 (already paused before the toggle flipped) stays WAITING — the toggle does NOT retroactively resolve it',
  run1After.status,
);

info('Run #2: starting FRESH now that autoApprove is ON...');
const run2 = await runWorkflow(client, wf.id, {});
const run2Finished = await waitForRunStatus(client, run2.id, ['COMPLETED', 'FAILED']);
assert(
  run2Finished.status === 'COMPLETED',
  'run #2 (started AFTER the toggle) resolves immediately, no pause',
  run2Finished.status,
);

info('Conclusion: autoApprove only affects runs that reach the node AFTER the change — an already-WAITING run must still be manually approved/rejected.');
summary();
closePrompt();
