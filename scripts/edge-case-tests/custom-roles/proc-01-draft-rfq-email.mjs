#!/usr/bin/env node
/**
 * PROC-01 — ProcurementAI drafts an RFQ email. docs/test-cases/08-ai-custom-roles-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('PROC-01: ProcurementAI drafts + sends an RFQ email');

const { client } = await freshCompany('PROC-01');
const email = await installSkill(client, 'email');
const employee = await hire(client, {
  name: 'ProcurementAI', role: 'CUSTOM',
  persona: 'You are an AI Procurement Specialist. Compare vendors, draft RFQs, track purchase requests, and summarise contract terms.',
});
await assignSkill(client, employee.id, email.id);

const res = await chat(client, employee.id, 'Right now, send an RFQ email to vendor@example.com asking for a quote on 50 laptops — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'send_email') {
  info('PASS: resolved to email.send_email.');
} else {
  warn('The employee did not call email.send_email (guardrail-vs-assigned-tool finding).');
}

closePrompt();
