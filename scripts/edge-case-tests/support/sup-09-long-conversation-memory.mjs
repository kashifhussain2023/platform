#!/usr/bin/env node
/**
 * SUP-09 — a long conversation beyond RECENT_MESSAGE_LIMIT (10).
 * docs/test-cases/04-ai-support-edge-cases.md
 * Sends an early fact, then 10+ filler messages, then asks to recall the
 * fact — a "known limitation" demo, not a strict pass/fail (semantic memory
 * recall is an explicitly deferred feature).
 */
import {
  section, info, warn, freshCompany, hire, closePrompt,
} from '../lib/harness.mjs';

section('SUP-09: recalling a fact from beyond the recent-message window');

const { client } = await freshCompany('SUP-09');
const employee = await hire(client, { name: 'SupportAI', role: 'SUPPORT' });
const conv = await client.post(`/employees/${employee.id}/conversations`, {});

async function say(content) {
  return client.post(`/conversations/${conv.id}/messages`, { content });
}

info('Message 1: establishing a fact ("my order number is ORD-77821")...');
await say('For reference, my order number is ORD-77821.');

for (let i = 2; i <= 11; i += 1) {
  info(`Message ${i}: filler...`);
  await say(`Filler message ${i} — just chatting about the weather.`);
}

info('Message 12: asking it to recall the order number from message 1...');
const res = await say('By the way, what was my order number again?');
info(`Reply: ${res.message.content}`);

if (res.message.content.includes('ORD-77821')) {
  info('It recalled the order number correctly.');
} else {
  warn('It did NOT recall the order number — consistent with the documented limitation (RECENT_MESSAGE_LIMIT=10, no semantic recall of older turns).');
}

closePrompt();
