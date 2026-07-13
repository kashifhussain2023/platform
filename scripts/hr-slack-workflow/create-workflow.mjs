#!/usr/bin/env node
/**
 * Creates the "Leave Request -> Slack Notify" workflow on the REAL Kashif
 * Recruiting tenant: AI-assesses a leave request against policy, gates on an
 * HR manager's approval, then posts the outcome to Slack. Idempotent — if a
 * workflow with this name already exists, it's reused instead of duplicated.
 *
 * Run: node scripts/hr-slack-workflow/create-workflow.mjs
 * Env: SLACK_CHANNEL — MUST be a channel that actually exists in your
 * workspace and that the bot is a member of (default #all-ai-employees).
 * Channel names are workspace-specific; find out what the bot can see via
 * POST /skills/installed/<slack-id>/tools/send_message/execute with any
 * name — a "not found" error lists every channel visible to it.
 */
import {
  section, info, kashifCompany, createWorkflow, findWorkflowByName, closePrompt,
} from '../edge-case-tests/lib/harness.mjs';

const WORKFLOW_NAME = 'Leave Request -> Slack Notify';
const channel = process.env.SLACK_CHANNEL || '#all-ai-employees';

section(`Create: ${WORKFLOW_NAME}`);

const { client } = await kashifCompany();

let workflow;
try {
  workflow = await findWorkflowByName(client, WORKFLOW_NAME);
  info(`Already exists: ${workflow.id} — reusing it, not creating a duplicate.`);
} catch {
  const definition = {
    nodes: [
      { id: 't1', type: 'TRIGGER', name: 'New leave request', config: {} },
      { id: 'r1', type: 'RETRIEVE', name: 'Leave policy', config: { k: 5, query: 'leave policy rules', outputKey: 'policy' } },
      {
        id: 'a1', type: 'AI_STEP', name: 'Assess request',
        config: {
          prompt: 'Decide if this leave request should be approved per policy. Reply ONLY \'true\' or \'false\'.\nFrom: {{trigger.from}}\nRequest: {{trigger.body}}\nPolicy: {{policy}}',
          outputKey: 'decision',
        },
      },
      { id: 'c1', type: 'CONDITION', name: 'Approved?', config: { op: 'eq', left: '{{decision}}', right: 'true' } },
      { id: 'ap1', type: 'APPROVAL', name: 'HR confirms', config: { message: 'Auto-assessed APPROVE for {{trigger.from}}. Confirm?' } },
      {
        id: 't2', type: 'TOOL_ACTION', name: 'Notify Slack (approved)',
        config: { tool: 'send_message', skillKey: 'slack', args: { channel, text: '✅ Leave approved for {{trigger.from}}' } },
      },
      {
        id: 't3', type: 'TOOL_ACTION', name: 'Notify Slack (review)',
        config: { tool: 'send_message', skillKey: 'slack', args: { channel, text: '⚠️ Leave request from {{trigger.from}} needs manual review' } },
      },
      { id: 'n1', type: 'NOTIFY', config: { message: 'Leave request for {{trigger.from}} processed — approved.' } },
      { id: 'n2', type: 'NOTIFY', config: { message: 'Leave request for {{trigger.from}} sent for manual review.' } },
    ],
    edges: [
      { from: 't1', to: 'r1' }, { from: 'r1', to: 'a1' }, { from: 'a1', to: 'c1' },
      { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 't3', branch: 'false' },
      { from: 'ap1', to: 't2' }, { from: 't2', to: 'n1' }, { from: 't3', to: 'n2' },
    ],
  };

  workflow = await createWorkflow(client, {
    name: WORKFLOW_NAME,
    description: 'On a new leave request, retrieve leave policy, AI-assess it, gate on HR approval, notify Slack.',
    definition,
  });
  info(`Created: ${workflow.id}`);

  const activated = await client.post(`/workflows/${workflow.id}/activate`);
  info(`Activated — status: ${activated.status}`);
}

info(`Slack channel: ${channel} (override with SLACK_CHANNEL=#other-channel)`);
info(`Workflow id: ${workflow.id} — pass this to test-workflow.mjs if needed.`);
closePrompt();
