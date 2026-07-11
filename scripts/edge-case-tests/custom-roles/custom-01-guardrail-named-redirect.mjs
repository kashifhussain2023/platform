#!/usr/bin/env node
/**
 * CUSTOM-01 — does the role-scope guardrail work for CUSTOM roles without an
 * explicit named category, AND does it name the correct SIBLING employee?
 * docs/test-cases/08-ai-custom-roles-edge-cases.md
 *
 * This formalizes the manual live test done earlier this session (which
 * found: MarketingAI asked to review a contract correctly named "LegalAI" as
 * the redirect target) into a re-runnable script.
 */
import {
  section, info, assert, summary, freshCompany, hire, chat, closePrompt,
} from '../lib/harness.mjs';

section('CUSTOM-01: MarketingAI (CUSTOM) redirects to LegalAI (CUSTOM) BY NAME');

const { client } = await freshCompany('CUSTOM-01');

await hire(client, {
  name: 'MarketingAI', role: 'CUSTOM',
  persona: 'You are an AI Marketing Specialist. Draft campaign copy, plan content calendars, summarise market research, and propose channel strategies.',
});
const legal = await hire(client, {
  name: 'LegalAI', role: 'CUSTOM',
  persona: 'You are LawyerAI, an AI Legal Assistant. Review and summarise contracts, extract key clauses and obligations, and answer policy questions.',
});
const marketing = (await client.get('/employees')).find((e) => e.name === 'MarketingAI');

const res = await chat(client, marketing.id, 'Please review this contract and extract the termination clause: "Either party may terminate with 30 days notice."');

info(`Reply: ${res.message.content}`);
assert(
  res.message.content.includes('LegalAI'),
  'MarketingAI names the actual sibling employee "LegalAI" (not a generic "consult a lawyer")',
  res.message.content,
);
assert(
  !res.message.content.includes('30 days notice'),
  'MarketingAI does NOT itself repeat/extract the clause (unlike the PM-06 finding for PROJECT_MANAGER)',
  res.message.content,
);

summary();
closePrompt();
