#!/usr/bin/env node
/**
 * Real-usage test for the "Leave Request -> Slack Notify" workflow (see
 * create-workflow.mjs). Runs it with a sample leave request, waits for the
 * HR APPROVAL gate, guides YOU to actually approve it in /approvals (a real
 * human decision — the whole point of that gate), then verifies the run
 * completes and a real Slack message went out.
 *
 * Run: node scripts/hr-slack-workflow/test-workflow.mjs
 * Needs: create-workflow.mjs already run, and the Slack skill CONNECTED
 * (see docs/slack-google-connector-setup.md).
 */
import {
  section, info, warn, assert, summary, kashifCompany, findWorkflowByName,
  runWorkflow, getRun, waitForRunStatus, guide, closePrompt,
} from '../edge-case-tests/lib/harness.mjs';

const WORKFLOW_NAME = 'Leave Request -> Slack Notify';
const channel = process.env.SLACK_CHANNEL || '#all-ai-employees';

section(`Test: ${WORKFLOW_NAME}`);

const { client } = await kashifCompany();

const skills = await client.get('/skills/installed');
const slack = skills.find((s) => s.skillKey === 'slack');
if (!slack || slack.connectionStatus !== 'CONNECTED') {
  warn(`Slack is not CONNECTED (status: ${slack?.connectionStatus ?? 'not installed'}) — the run will fail at the TOOL_ACTION step. Connect it from /skills first.`);
}

const workflow = await findWorkflowByName(client, WORKFLOW_NAME);
info(`Using workflow ${workflow.id}`);

const trigger = {
  from: 'employee@kashif-it.com',
  subject: 'Leave Request',
  body: 'I would like to request 3 days of leave from Aug 1-3 for a family event, well within my accrued balance.',
};
let run = await runWorkflow(client, workflow.id, trigger);
info(`Run created: ${run.id} (status ${run.status})`);

run = await waitForRunStatus(client, run.id, ['WAITING', 'COMPLETED', 'FAILED']);

if (run.status === 'WAITING') {
  await guide([
    `Open http://localhost:3000/approvals (logged in as kashifhussain146@gmail.com).`,
    `Find the pending "HR confirms" approval for ${trigger.from}.`,
    `Click Approve.`,
  ]);
  run = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);
}

assert(run.status === 'COMPLETED', 'workflow run reached COMPLETED', run.status);

const full = await getRun(client, run.id);
for (const step of full.steps ?? []) {
  info(`  [${step.type}] ${step.nodeId} -> ${step.status}${step.error ? ` (${step.error})` : ''}`);
}

// The ToolCallDto (step.output) echoes back the args WE sent (output.args),
// separately from output.result — which for Slack carries the RESOLVED
// channel ID (e.g. "C0BGT25S22Y"), not the name. Match on output.args.
const slackStep = (full.steps ?? []).find(
  (s) => s.type === 'TOOL_ACTION' && s.output?.args?.channel === channel,
);
assert(!!slackStep?.output?.ok, 'a TOOL_ACTION step reported a successful Slack send', JSON.stringify(slackStep?.output));

info(`Now check Slack channel ${channel} for the real message.`);
summary();
closePrompt();
