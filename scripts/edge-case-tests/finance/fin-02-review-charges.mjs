#!/usr/bin/env node
/**
 * FIN-02 — "Review our recent charges for anything unusual" (fixed this
 * session — stripe.list_charges added). docs/test-cases/06-ai-finance-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('FIN-02: FinanceAI reviews recent charges (fixed — stripe.list_charges)');

const { client } = await freshCompany('FIN-02');
const stripe = await installSkill(client, 'stripe');
const employee = await hire(client, { name: 'FinanceAI', role: 'ACCOUNTANT' });
await assignSkill(client, employee.id, stripe.id);

const res = await chat(client, employee.id, 'Right now, list our recent Stripe charges so I can review them for anything unusual — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'list_charges') {
  info('PASS: resolved to stripe.list_charges — this tool did not exist before this session.');
} else {
  warn('The employee did not call stripe.list_charges (see the SUP-06/HR-04/HR-05 guardrail-vs-assigned-tool finding).');
}

closePrompt();
