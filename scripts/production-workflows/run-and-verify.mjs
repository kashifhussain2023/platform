#!/usr/bin/env node
/**
 * Generic real-usage runner for any of the 11 production workflows — avoids
 * 11 near-identical test scripts. Runs the named workflow with its sample
 * trigger (definitions.mjs), pausing at EVERY approval gate it hits (some
 * workflows have two in a row, e.g. manager + HR) to guide YOU to actually
 * approve it in /approvals — a real human decision, not simulated.
 *
 * Run: node scripts/production-workflows/run-and-verify.mjs "<name substring>" ['{"trigger":"override"}']
 * Examples:
 *   node scripts/production-workflows/run-and-verify.mjs "Offer Approval"
 *   node scripts/production-workflows/run-and-verify.mjs "Onboarding"
 *   node scripts/production-workflows/run-and-verify.mjs "Candidate Resume Screening" '{"from":"me@x.com","subject":"App","cv":"..."}'
 */
import {
  section, info, warn, assert, summary, kashifCompany, findWorkflowByName,
  runWorkflow, getRun, waitForRunStatus, guide, closePrompt,
} from '../edge-case-tests/lib/harness.mjs';
import { WORKFLOWS } from './definitions.mjs';

const nameArg = process.argv[2];
const triggerOverride = process.argv[3] ? JSON.parse(process.argv[3]) : null;

if (!nameArg) {
  console.error('Usage: node run-and-verify.mjs "<workflow name substring>" [triggerJsonOverride]');
  process.exit(1);
}

const spec = WORKFLOWS.find((w) => w.name.toLowerCase().includes(nameArg.toLowerCase()));
if (!spec) {
  console.error(`No workflow definition matches "${nameArg}". Known: ${WORKFLOWS.map((w) => w.name).join(', ')}`);
  process.exit(1);
}

section(`Run: ${spec.name}`);

const { client } = await kashifCompany();
const workflow = await findWorkflowByName(client, spec.name);
info(`Using workflow ${workflow.id} (status: ${workflow.status})`);
if (spec.notes) info(`Note: ${spec.notes}`);

const trigger = triggerOverride ?? spec.sampleTrigger ?? {};
let run = await runWorkflow(client, workflow.id, trigger);
info(`Run created: ${run.id}`);

let approvalRounds = 0;
run = await waitForRunStatus(client, run.id, ['WAITING', 'COMPLETED', 'FAILED']);
while (run.status === 'WAITING') {
  approvalRounds += 1;
  const approvals = await client.get('/approvals?status=PENDING');
  const mine = approvals.find((a) => a.workflowRunId === run.id);
  await guide([
    `Open http://localhost:3000/approvals (logged in as kashifhussain146@gmail.com).`,
    `Find the pending approval: "${mine?.description ?? '(see /approvals)'}"`,
    `Click Approve.`,
  ]);
  run = await waitForRunStatus(client, run.id, ['WAITING', 'COMPLETED', 'FAILED']);
}

assert(run.status === 'COMPLETED', 'workflow run reached COMPLETED', run.status);
info(`Approval gates hit: ${approvalRounds}`);

const nodeNames = Object.fromEntries(spec.definition.nodes.map((n) => [n.id, n.name ?? n.id]));
const full = await getRun(client, run.id);
for (const step of full.steps ?? []) {
  const outcome = step.output?.ok === false ? ` — ${step.output?.error ?? step.error ?? 'tool failed'}` : '';
  info(`  [${step.type}] ${nodeNames[step.nodeId] ?? step.nodeId} -> ${step.status}${step.error ? ` (${step.error})` : outcome}`);
}

const failedTool = (full.steps ?? []).find((s) => s.type === 'TOOL_ACTION' && s.status !== 'COMPLETED');
if (failedTool) {
  warn(`Tool step "${failedTool.nodeId}" did not complete — check the error above (often a channel/name/scope issue, not a workflow bug).`);
}

summary();
closePrompt();
