#!/usr/bin/env node
/**
 * OPS-01 — "What issues are still open in ENG?" (monitor processes; fixed
 * this session — jira.list_issues/get_issue). docs/test-cases/08-ai-custom-roles-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('OPS-01: OperationsAI monitors open Jira issues (fixed — jira.list_issues)');

const { client } = await freshCompany('OPS-01');
const jira = await installSkill(client, 'jira');
const employee = await hire(client, {
  name: 'OperationsAI', role: 'CUSTOM',
  persona: 'You are an AI Operations Coordinator. Monitor recurring processes, triage incoming requests, produce status reports, and flag bottlenecks.',
});
await assignSkill(client, employee.id, jira.id);

const res = await chat(client, employee.id, 'Right now, list the open issues in the ENG project so I can monitor progress — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'list_issues') {
  info('PASS: resolved to jira.list_issues.');
} else {
  warn('The employee did not call jira.list_issues (guardrail-vs-assigned-tool finding).');
}

closePrompt();
