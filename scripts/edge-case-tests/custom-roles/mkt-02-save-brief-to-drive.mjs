#!/usr/bin/env node
/**
 * MKT-02 — "Save this campaign brief to Drive" (gdrive.upload_file).
 * docs/test-cases/08-ai-custom-roles-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('MKT-02: MarketingAI saves a brief to Drive (gdrive.upload_file)');

const { client } = await freshCompany('MKT-02');
const gdrive = await installSkill(client, 'gdrive');
const employee = await hire(client, {
  name: 'MarketingAI', role: 'CUSTOM',
  persona: 'You are an AI Marketing Specialist. Draft campaign copy, plan content calendars, summarise market research, and propose channel strategies.',
});
await assignSkill(client, employee.id, gdrive.id);

const res = await chat(client, employee.id, 'Right now, save a file named "q3-campaign-brief.txt" to Google Drive with the content "Launch AI scheduling feature in Q3." — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'upload_file') {
  info('PASS: resolved to gdrive.upload_file.');
} else {
  warn('The employee did not call gdrive.upload_file (guardrail-vs-assigned-tool finding).');
}

closePrompt();
