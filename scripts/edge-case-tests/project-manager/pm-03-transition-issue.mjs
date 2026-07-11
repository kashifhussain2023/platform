#!/usr/bin/env node
/**
 * PM-03 — "Move ENG-123 to Done" (fixed this session — jira.transition_issue).
 * docs/test-cases/07-ai-project-manager-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('PM-03: PMAI transitions a Jira issue (fixed — jira.transition_issue)');

const { client } = await freshCompany('PM-03');
const jira = await installSkill(client, 'jira');
const employee = await hire(client, { name: 'PMAI', role: 'PROJECT_MANAGER' });
await assignSkill(client, employee.id, jira.id);

const res = await chat(client, employee.id, 'Right now, move Jira issue ENG-123 to "Done" — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'transition_issue') {
  info('PASS: resolved to jira.transition_issue — this tool did not exist before this session (only create_issue did).');
} else {
  warn('The employee did not call jira.transition_issue (guardrail-vs-assigned-tool finding).');
}

closePrompt();
