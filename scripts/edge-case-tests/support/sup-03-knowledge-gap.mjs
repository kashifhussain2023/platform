#!/usr/bin/env node
/**
 * SUP-03 — a question with ZERO relevant knowledge-base content.
 * docs/test-cases/04-ai-support-edge-cases.md
 * Claim: low confidence / grounded:false / needsApproval:true, and the reply
 * says it plainly rather than fabricating an answer.
 */
import {
  section, info, assert, summary, freshCompany, hire, chat, closePrompt,
} from '../lib/harness.mjs';

section('SUP-03: question with no relevant knowledge-base content');

const { client } = await freshCompany('SUP-03');
const employee = await hire(client, { name: 'SupportAI', role: 'SUPPORT' });
// Deliberately no knowledge docs uploaded — nothing to retrieve.

const res = await chat(
  client,
  employee.id,
  'What is our company\'s policy on the Zorbnak-9000 device recall procedure?',
);

info(`Reply: ${res.message.content}`);
info(`Validation: ${JSON.stringify(res.validation)}`);
assert(res.validation.grounded === false, 'validation.grounded is false (nothing to ground the answer in)', res.validation.grounded);
assert(res.validation.needsApproval === true, 'validation.needsApproval is true (low confidence flagged)', res.validation.needsApproval);

summary();
closePrompt();
