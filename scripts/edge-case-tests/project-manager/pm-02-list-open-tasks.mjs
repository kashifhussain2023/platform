#!/usr/bin/env node
/**
 * PM-02 — "List all open tasks in the ENG project" (fixed this session —
 * jira.list_issues). docs/test-cases/07-ai-project-manager-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('PM-02: PMAI lists open Jira issues (fixed — jira.list_issues)');

const { client } = await freshCompany('PM-02');
const jira = await installSkill(client, 'jira');
const employee = await hire(client, { name: 'PMAI', role: 'PROJECT_MANAGER' });
await assignSkill(client, employee.id, jira.id);

const res = await chat(client, employee.id, 'Right now, list all open issues in the ENG project — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'list_issues') {
  info('PASS: resolved to jira.list_issues — this tool did not exist before this session.');
} else {
  warn('The employee did not call jira.list_issues (guardrail-vs-assigned-tool finding).');
}

closePrompt();
