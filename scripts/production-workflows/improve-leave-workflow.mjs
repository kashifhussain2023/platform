#!/usr/bin/env node
/**
 * Improves the existing "Leave Request -> Slack Notify" workflow (built
 * earlier this session) to match the requested chart: adds an Email step
 * alongside Slack, and a Calendar "Mark Leave" step on the approved branch —
 * the one new skill this workflow hadn't exercised yet.
 *
 * Run: node scripts/production-workflows/improve-leave-workflow.mjs
 */
import { section, info, kashifCompany, findWorkflowByName } from '../edge-case-tests/lib/harness.mjs';

const WORKFLOW_NAME = 'Leave Request -> Slack Notify';
const channel = process.env.SLACK_CHANNEL || '#all-ai-employees';

section(`Improve: ${WORKFLOW_NAME}`);

const { client } = await kashifCompany();
const existing = await findWorkflowByName(client, WORKFLOW_NAME);

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
    { id: 's1', type: 'TOOL_ACTION', name: 'Slack notify (approved)', config: { tool: 'send_message', skillKey: 'slack', args: { channel, text: '✅ Leave approved for {{trigger.from}}' } } },
    { id: 'e1', type: 'TOOL_ACTION', name: 'Email employee (approved)', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.from}}', subject: 'Leave request approved', body: 'Your leave request has been approved.' } } },
    { id: 'cal1', type: 'TOOL_ACTION', name: 'Mark leave on calendar', config: { tool: 'create_event', skillKey: 'calendar', args: { title: 'Leave — {{trigger.from}}', start: '{{trigger.leaveStart}}', end: '{{trigger.leaveEnd}}' } } },
    { id: 'n1', type: 'NOTIFY', config: { message: 'Leave request for {{trigger.from}} processed — approved and marked on calendar.' } },
    { id: 's2', type: 'TOOL_ACTION', name: 'Slack notify (review)', config: { tool: 'send_message', skillKey: 'slack', args: { channel, text: '⚠️ Leave request from {{trigger.from}} needs manual review' } } },
    { id: 'e2', type: 'TOOL_ACTION', name: 'Email employee (review)', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.from}}', subject: 'Leave request needs review', body: 'Your leave request needs manual review before approval.' } } },
    { id: 'n2', type: 'NOTIFY', config: { message: 'Leave request for {{trigger.from}} sent for manual review.' } },
  ],
  edges: [
    { from: 't1', to: 'r1' }, { from: 'r1', to: 'a1' }, { from: 'a1', to: 'c1' },
    { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 's2', branch: 'false' },
    { from: 'ap1', to: 's1' }, { from: 's1', to: 'e1' }, { from: 'e1', to: 'cal1' }, { from: 'cal1', to: 'n1' },
    { from: 's2', to: 'e2' }, { from: 'e2', to: 'n2' },
  ],
};

const updated = await client.patch(`/workflows/${existing.id}`, {
  definition,
  expectedUpdatedAt: existing.updatedAt,
});
info(`Updated ${updated.id} — status ${updated.status}, ${updated.definition.nodes.length} nodes.`);
info('New: Email step (both branches) + Calendar "Mark leave" step on approval. Trigger now also needs leaveStart/leaveEnd (ISO) for the calendar event.');
