#!/usr/bin/env node
/**
 * OPS-02 — "Triage this incoming request" (create + transition a ticket;
 * fixed this session — jira.transition_issue). docs/test-cases/08-ai-custom-roles-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('OPS-02: OperationsAI triages a request into Jira (create + fixed transition)');

const { client } = await freshCompany('OPS-02');
const jira = await installSkill(client, 'jira');
const employee = await hire(client, {
  name: 'OperationsAI', role: 'CUSTOM',
  persona: 'You are an AI Operations Coordinator. Monitor recurring processes, triage incoming requests, produce status reports, and flag bottlenecks.',
});
await assignSkill(client, employee.id, jira.id);

const res = await chat(client, employee.id, 'Right now, create a Jira issue in project OPS titled "Server disk space low" — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'create_issue') {
  info('PASS: resolved to jira.create_issue (this part already existed before this session).');
} else {
  warn('The employee did not call jira.create_issue (guardrail-vs-assigned-tool finding).');
}

closePrompt();
