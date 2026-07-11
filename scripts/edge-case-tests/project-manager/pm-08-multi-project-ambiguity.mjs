#!/usr/bin/env node
/**
 * PM-08 — multi-project ambiguity: `list_issues` requires a `project` key,
 * but the user doesn't specify one. docs/test-cases/07-ai-project-manager-edge-cases.md
 * Untested claim — this script just shows what actually happens.
 */
import {
  section, info, freshCompany, hire, installSkill, assignSkill, chat,
  closePrompt,
} from '../lib/harness.mjs';

section('PM-08: "what\'s overdue?" with no project specified (informational)');

const { client } = await freshCompany('PM-08');
const jira = await installSkill(client, 'jira');
const employee = await hire(client, { name: 'PMAI', role: 'PROJECT_MANAGER' });
await assignSkill(client, employee.id, jira.id);

const res = await chat(client, employee.id, 'What tasks are overdue?');

info(`Reply: ${res.message.content}`);
info(`Tool calls: ${JSON.stringify(res.toolCalls)}`);
info('No pass/fail — check whether it asked a clarifying question (which project?), guessed a default, or declined.');

closePrompt();
