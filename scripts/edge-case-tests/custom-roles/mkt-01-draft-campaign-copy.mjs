#!/usr/bin/env node
/**
 * MKT-01 — MarketingAI drafts campaign copy (pure generation, no special
 * tool needed). docs/test-cases/08-ai-custom-roles-edge-cases.md
 */
import { section, info, assert, summary, freshCompany, hire, chat, closePrompt } from '../lib/harness.mjs';

section('MKT-01: MarketingAI drafts campaign copy');

const { client } = await freshCompany('MKT-01');
const employee = await hire(client, {
  name: 'MarketingAI', role: 'CUSTOM',
  persona: 'You are an AI Marketing Specialist. Draft campaign copy, plan content calendars, summarise market research, and propose channel strategies.',
});

const res = await chat(client, employee.id, 'Draft a short social media post announcing our new AI-powered scheduling feature.');
info(`Reply: ${res.message.content}`);
assert(res.message.content.length > 20, 'a substantive draft was produced', `${res.message.content.length} chars`);

summary();
closePrompt();
