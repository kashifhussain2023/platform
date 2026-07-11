#!/usr/bin/env node
/**
 * SUP-04 — a PAUSED/DISABLED employee receiving a message.
 * docs/test-cases/04-ai-support-edge-cases.md
 * Claim: 409 Conflict, not a silent failure or a response from a paused employee.
 */
import {
  section, assert, summary, freshCompany, hire, closePrompt,
} from '../lib/harness.mjs';

section('SUP-04: message to a PAUSED employee');

const { client } = await freshCompany('SUP-04');
const employee = await hire(client, { name: 'SupportAI', role: 'SUPPORT' });
await client.patch(`/employees/${employee.id}`, { status: 'PAUSED' });

let status;
try {
  const conv = await client.post(`/employees/${employee.id}/conversations`, {});
  await client.post(`/conversations/${conv.id}/messages`, { content: 'hello?' });
  status = 200;
} catch (err) {
  status = err.status;
}
assert(status === 409, 'sending a message to a PAUSED employee returns 409 Conflict', `got ${status}`);

summary();
closePrompt();
