#!/usr/bin/env node
/**
 * HR-04 — onboarding scheduling (calendar.create_event). docs/test-cases/05-ai-hr-edge-cases.md
 *
 * SAME systemic finding as SUP-06: running this live showed the role-scope
 * guardrail can refuse an explicitly-assigned tool if its phrasing doesn't
 * obviously match the role's scope wording — reported informationally.
 */
import {
  section, info, warn, freshCompany, hire, installSkill,
  assignSkill, chat, closePrompt,
} from '../lib/harness.mjs';

section('HR-04: HRAI schedules an onboarding call (assigned calendar tool)');

const { client } = await freshCompany('HR-04');
const calendar = await installSkill(client, 'calendar');
const employee = await hire(client, { name: 'HRAI', role: 'HR' });
await assignSkill(client, employee.id, calendar.id);

const res = await chat(
  client, employee.id,
  'Right now, schedule an onboarding call titled "New Hire Onboarding" for 2026-08-01 10:00 to 10:30 — just do it, don\'t ask me anything.',
);

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.skillKey === 'calendar' && call?.tool === 'create_event') {
  info('PASS: resolved to calendar.create_event as expected.');
} else {
  warn('The employee refused/did not call calendar.create_event even though it IS assigned —');
  warn('same systemic pattern as SUP-06: the guardrail\'s wording didn\'t obviously cover "scheduling."');
}

closePrompt();
