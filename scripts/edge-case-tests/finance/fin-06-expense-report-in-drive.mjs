#!/usr/bin/env node
/**
 * FIN-06 — an expense document lives in Google Drive (fixed this session —
 * gdrive.read_file). docs/test-cases/06-ai-finance-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('FIN-06: FinanceAI reads an expense report from Drive');

const { client } = await freshCompany('FIN-06');
const gdrive = await installSkill(client, 'gdrive');
const employee = await hire(client, { name: 'FinanceAI', role: 'ACCOUNTANT' });
await assignSkill(client, employee.id, gdrive.id);

const res = await chat(client, employee.id, 'Right now, read the file "q3-expense-report.txt" from Google Drive and summarize it — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'read_file') {
  info('PASS: resolved to gdrive.read_file.');
} else {
  warn('The employee did not call gdrive.read_file (guardrail-vs-assigned-tool finding).');
}

closePrompt();
