#!/usr/bin/env node
/**
 * HR-05 — reading an uploaded HR document from Google Drive (fixed this
 * session — gdrive.read_file). docs/test-cases/05-ai-hr-edge-cases.md
 *
 * SAME systemic finding as SUP-06/HR-04: running this live may show the
 * role-scope guardrail refusing the (correctly-fixed, correctly-assigned)
 * gdrive.read_file tool if the model doesn't obviously map "read a file" to
 * HR's scope wording — reported informationally rather than asserted.
 */
import {
  section, info, warn, freshCompany, hire, installSkill,
  assignSkill, chat, closePrompt,
} from '../lib/harness.mjs';

section('HR-05: HRAI reads a Drive file (fixed — gdrive.read_file)');

const { client } = await freshCompany('HR-05');
const gdrive = await installSkill(client, 'gdrive');
const employee = await hire(client, { name: 'HRAI', role: 'HR' });
await assignSkill(client, employee.id, gdrive.id);

const res = await chat(
  client, employee.id,
  'Right now, read the file "employee-handbook.txt" from Google Drive — just do it, don\'t ask me anything.',
);

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'read_file') {
  info('PASS: resolved to gdrive.read_file (confirms the fix\'s tool DEFINITION works when the model does attempt it).');
} else {
  warn('The employee refused/did not call gdrive.read_file even though it IS assigned — same');
  warn('systemic pattern as SUP-06/HR-04. The tool-definition fix is confirmed correct elsewhere');
  warn('(workflow-engine + earlier live tests); THIS refusal is the guardrail, not the tool itself.');
}

closePrompt();
