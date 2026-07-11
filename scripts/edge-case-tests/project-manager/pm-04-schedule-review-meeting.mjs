#!/usr/bin/env node
/**
 * PM-04 — scheduling a status-review meeting (calendar.create_event, already
 * worked before this session). docs/test-cases/07-ai-project-manager-edge-cases.md
 */
import {
  section, info, warn, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('PM-04: PMAI schedules a status-review meeting');

const { client } = await freshCompany('PM-04');
const calendar = await installSkill(client, 'calendar');
const employee = await hire(client, { name: 'PMAI', role: 'PROJECT_MANAGER' });
await assignSkill(client, employee.id, calendar.id);

const res = await chat(client, employee.id, 'Right now, schedule a "Weekly Status Review" for 2026-08-03 15:00 to 15:30 — just do it.');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
const call = res.toolCalls?.[0];
if (call?.tool === 'create_event') {
  info('PASS: resolved to calendar.create_event.');
} else {
  warn('The employee did not call calendar.create_event (guardrail-vs-assigned-tool finding).');
}

closePrompt();
