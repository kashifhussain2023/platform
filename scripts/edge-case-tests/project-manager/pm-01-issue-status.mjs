#!/usr/bin/env node
/**
 * PM-01 — "What's the status of ENG-123?" (fixed this session — jira.get_issue).
 * docs/test-cases/07-ai-project-manager-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('PM-01: PMAI checks a Jira issue\'s status (fixed — jira.get_issue)');

const { client } = await freshCompany('PM-01');
const jira = await installSkill(client, 'jira');
const employee = await hire(client, { name: 'PMAI', role: 'PROJECT_MANAGER' });
await assignSkill(client, employee.id, jira.id);

const res = await chat(client, employee.id, 'Right now, get the status of Jira issue ENG-123 — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'get_issue') {
  info('PASS: resolved to jira.get_issue — this tool did not exist before this session.');
} else {
  warn('The employee did not call jira.get_issue (see the guardrail-vs-assigned-tool finding from SUP-06/FIN-03/FIN-06).');
}

closePrompt();
