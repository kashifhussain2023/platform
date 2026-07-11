#!/usr/bin/env node
/**
 * SUP-08 — a support ticket in a non-English language (Hindi).
 * docs/test-cases/04-ai-support-edge-cases.md
 * Informational only.
 */
import { section, info, freshCompany, hire, chat, closePrompt } from '../lib/harness.mjs';

section('SUP-08: multi-language (Hindi) support ticket (informational)');

const { client } = await freshCompany('SUP-08');
const employee = await hire(client, { name: 'SupportAI', role: 'SUPPORT' });

const res = await chat(client, employee.id, 'mera app save button click karne pe crash ho raha hai, kya karu?');

info(`Reply: ${res.message.content}`);
info('No pass/fail — judge whether the reply sensibly responded in/to Hindi.');
closePrompt();
