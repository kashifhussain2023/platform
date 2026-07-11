#!/usr/bin/env node
/**
 * PROC-02 — "Summarize this vendor contract" (reads a Drive file — fixed
 * this session, was fully broken before). docs/test-cases/08-ai-custom-roles-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('PROC-02: ProcurementAI reads a vendor contract from Drive (fixed — gdrive.read_file)');

const { client } = await freshCompany('PROC-02');
const gdrive = await installSkill(client, 'gdrive');
const employee = await hire(client, {
  name: 'ProcurementAI', role: 'CUSTOM',
  persona: 'You are an AI Procurement Specialist. Compare vendors, draft RFQs, track purchase requests, and summarise contract terms.',
});
await assignSkill(client, employee.id, gdrive.id);

const res = await chat(client, employee.id, 'Right now, read the file "vendor-contract-acme.txt" from Google Drive and summarize the key terms — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'read_file') {
  info('PASS: resolved to gdrive.read_file — this scenario was FULLY BROKEN before this session (only upload_file existed).');
} else {
  warn('The employee did not call gdrive.read_file (guardrail-vs-assigned-tool finding).');
}

closePrompt();
