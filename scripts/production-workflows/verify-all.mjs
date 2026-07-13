#!/usr/bin/env node
/**
 * Internal verification helper (not part of the interactive suite): runs
 * every MANUAL/SCHEDULE workflow with its sample trigger and auto-approves
 * via the API, to confirm the graphs are wired correctly end-to-end before
 * handing off to run-and-verify.mjs for real human-approved runs.
 */
import { kashifCompany, findWorkflowByName, runWorkflow, getRun, waitForRunStatus } from '../edge-case-tests/lib/harness.mjs';
import { WORKFLOWS } from './definitions.mjs';

const { client } = await kashifCompany();
const results = [];

for (const spec of WORKFLOWS) {
  if (spec.triggerType === 'EVENT') { results.push({ name: spec.name, status: 'SKIPPED (Gmail-triggered, DRAFT by design)' }); continue; }
  try {
    const wf = await findWorkflowByName(client, spec.name);
    let run = await runWorkflow(client, wf.id, spec.sampleTrigger ?? {});
    run = await waitForRunStatus(client, run.id, ['WAITING', 'COMPLETED', 'FAILED'], { tries: 40, delayMs: 500 });
    let rounds = 0;
    while (run.status === 'WAITING' && rounds < 5) {
      rounds += 1;
      const approvals = await client.get('/approvals?status=PENDING');
      const mine = approvals.find((a) => a.workflowRunId === run.id);
      if (!mine) break;
      await client.post(`/approvals/${mine.id}/approve`, {});
      run = await waitForRunStatus(client, run.id, ['WAITING', 'COMPLETED', 'FAILED'], { tries: 40, delayMs: 500 });
    }
    const full = await getRun(client, run.id);
    const failedSteps = (full.steps ?? []).filter((s) => s.status === 'FAILED').map((s) => `${s.nodeId}: ${s.error}`);
    results.push({ name: spec.name, status: run.status, rounds, failedSteps });
  } catch (e) {
    results.push({ name: spec.name, status: 'ERROR', error: e.body ?? e.message });
  }
}

console.log(JSON.stringify(results, null, 2));
