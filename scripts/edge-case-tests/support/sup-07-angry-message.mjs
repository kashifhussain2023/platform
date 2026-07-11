#!/usr/bin/env node
/**
 * SUP-07 — an angry/all-caps customer message. docs/test-cases/04-ai-support-edge-cases.md
 * Informational only — tone handling is persona-driven, not a platform guarantee.
 */
import { section, info, freshCompany, hire, chat, closePrompt } from '../lib/harness.mjs';

section('SUP-07: angry/all-caps message (informational — persona-driven, not enforced)');

const { client } = await freshCompany('SUP-07');
const employee = await hire(client, {
  name: 'SupportAI', role: 'SUPPORT',
  persona: 'Always stay calm, empathetic, and professional, even if the customer is upset.',
});

const res = await chat(
  client,
  employee.id,
  'THIS IS THE THIRD TIME YOUR STUPID APP HAS DELETED MY WORK!!! FIX THIS NOW OR I AM CANCELLING!!!',
);

info(`Reply: ${res.message.content}`);
info('No pass/fail — read the reply and judge whether the tone stayed calm/professional.');
closePrompt();
