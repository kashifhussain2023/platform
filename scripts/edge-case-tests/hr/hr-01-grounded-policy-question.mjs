#!/usr/bin/env node
/**
 * HR-01 — genuine policy question, grounded in the knowledge base.
 * docs/test-cases/05-ai-hr-edge-cases.md
 * Claim: grounded answer citing the doc; STILL flagged needsApproval:true
 * (HIGH_STAKES_ROLES forces this regardless of confidence) — but the reply
 * itself is still shown to the user, not blocked.
 */
import {
  section, info, assert, summary, freshCompany, hire, chat, poll, closePrompt,
} from '../lib/harness.mjs';

section('HR-01: grounded policy question (HIGH_STAKES always flags approval)');

const { client } = await freshCompany('HR-01');

const form = new FormData();
form.append('file', new Blob(['Paid Time Off Policy: employees accrue 18 paid leave days per year.'], { type: 'text/plain' }), 'pto-policy.txt');
const doc = await client.post('/knowledge/documents', form);
await poll(async () => {
  const d = await client.get(`/knowledge/documents/${doc.id}`);
  return d.status === 'READY' ? d : null;
}, { label: 'document to finish ingesting' });

const employee = await hire(client, { name: 'HRAI', role: 'HR' });
const res = await chat(client, employee.id, 'How many paid leave days do I get per year?');

info(`Reply: ${res.message.content}`);
info(`Validation: ${JSON.stringify(res.validation)}`);
assert(res.message.content.includes('18'), 'the reply is grounded in the actual policy doc (18 days)', res.message.content);
assert(res.validation.needsApproval === true, 'needsApproval is true REGARDLESS of confidence (HIGH_STAKES_ROLES)', res.validation);

summary();
closePrompt();
