#!/usr/bin/env node
/**
 * FIN-01 — "What's our current Stripe balance?" (fixed this session —
 * stripe.get_balance added). docs/test-cases/06-ai-finance-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('FIN-01: FinanceAI checks the Stripe balance (fixed — stripe.get_balance)');

const { client } = await freshCompany('FIN-01');
const stripe = await installSkill(client, 'stripe');
const employee = await hire(client, { name: 'FinanceAI', role: 'ACCOUNTANT' });
await assignSkill(client, employee.id, stripe.id);

const res = await chat(client, employee.id, 'Right now, check our current Stripe account balance — just do it, don\'t ask me anything.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'get_balance') {
  info('PASS: resolved to stripe.get_balance — this tool did not exist before this session.');
} else {
  warn('The employee did not call stripe.get_balance (see the SUP-06/HR-04/HR-05 guardrail-vs-assigned-tool finding).');
}

closePrompt();
