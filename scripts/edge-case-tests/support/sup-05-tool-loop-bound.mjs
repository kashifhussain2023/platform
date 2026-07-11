#!/usr/bin/env node
/**
 * SUP-05 — a support question needing 4+ tool calls to fully resolve
 * (MAX_ACT_ITERATIONS=3 bounds the loop). docs/test-cases/04-ai-support-edge-cases.md
 *
 * Best-effort/informational: a real LLM can't be FORCED to make exactly N
 * tool calls — this just asks a multi-part question and reports how many
 * tool calls actually happened and what the final answer looked like, so you
 * can judge the degraded-output quality yourself.
 */
import {
  section, info, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('SUP-05: multi-step request against the 3-tool-call bound (informational)');

const { client } = await freshCompany('SUP-05');
const slack = await installSkill(client, 'slack');
const http = await installSkill(client, 'http');
const employee = await hire(client, { name: 'SupportAI', role: 'SUPPORT' });
await assignSkill(client, employee.id, slack.id);
await assignSkill(client, employee.id, http.id);

const res = await chat(
  client,
  employee.id,
  'Please: 1) post a Slack message to #support saying "checking now", 2) fetch https://example.com, ' +
  '3) post ANOTHER Slack message with a summary, 4) fetch https://example.org for good measure.',
);

info(`Final answer: ${res.message.content}`);
info(`Tool calls actually made: ${res.toolCalls?.length ?? 0} (bound is MAX_ACT_ITERATIONS=3)`);
info('No pass/fail — eyeball whether the final answer honestly reflects only what it managed to do within the bound.');

closePrompt();
