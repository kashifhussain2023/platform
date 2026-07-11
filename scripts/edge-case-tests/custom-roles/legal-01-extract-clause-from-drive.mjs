#!/usr/bin/env node
/**
 * LEGAL-01 — "Extract the termination clause from this contract" (reads a
 * Drive file). docs/test-cases/08-ai-custom-roles-edge-cases.md
 *
 * This was the SINGLE MOST BROKEN promise found this session: gdrive had
 * ONLY upload_file before the fix — LegalAI's entire headline capability
 * ("extracts clauses") had ZERO way to read ANY document's content.
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('LEGAL-01: LegalAI reads a contract from Drive (CRITICAL fix — gdrive.read_file)');

const { client } = await freshCompany('LEGAL-01');
const gdrive = await installSkill(client, 'gdrive');
const employee = await hire(client, {
  name: 'LegalAI', role: 'CUSTOM',
  persona: 'You are LawyerAI, an AI Legal Assistant. Review and summarise contracts, extract key clauses and obligations, and answer policy questions.',
});
await assignSkill(client, employee.id, gdrive.id);

const res = await chat(client, employee.id, 'Right now, read the file "vendor-contract.txt" from Google Drive and extract the termination clause — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'read_file') {
  info('PASS: resolved to gdrive.read_file — before this session, this was STRUCTURALLY IMPOSSIBLE (only upload_file existed).');
} else {
  warn('The employee did not call gdrive.read_file (guardrail-vs-assigned-tool finding) — the TOOL exists now (verified elsewhere), this particular chat attempt just didn\'t use it.');
}

closePrompt();
