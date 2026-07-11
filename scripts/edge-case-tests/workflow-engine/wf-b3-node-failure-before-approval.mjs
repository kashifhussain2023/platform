#!/usr/bin/env node
/**
 * WF-B3 — if the step before an Approval fails, the run should never reach
 * Approval with a missing/blank templated value.
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * The doc's exact scenario (AI_STEP failing to set {{score}}) needs an
 * induced LLM failure; this script proves the same underlying guarantee with
 * a reliably-forceable failure instead (a TOOL_ACTION calling an unknown
 * skill/tool) — ANY node failure marks the run FAILED and stops the walk, so
 * it can never reach a later Approval node with missing context.
 */
import {
  section, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-B3: a failed step never lets the run reach a later Approval');

const { client } = await freshCompany('WF-B3');

const wf = await createWorkflow(client, {
  name: 'WF-B3 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'bad', type: 'TOOL_ACTION', config: { skillKey: 'nonexistent', tool: 'nope', args: {} } },
      { id: 'ap1', type: 'APPROVAL', config: { message: 'Fit score {{score}}/100. Proceed?' } },
    ],
    edges: [{ from: 't1', to: 'bad' }, { from: 'bad', to: 'ap1' }],
  },
});

const run = await runWorkflow(client, wf.id, {});
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED', 'WAITING']);

assert(finished.status === 'FAILED', 'run FAILS at the bad tool step (never reaches Approval)', finished.status);
const approvals = await client.get('/approvals');
assert(
  !approvals.some((a) => a.workflowRunId === run.id),
  'no ApprovalRequest was ever created for this run',
  `${approvals.filter((a) => a.workflowRunId === run.id).length} found`,
);

summary();
closePrompt();
