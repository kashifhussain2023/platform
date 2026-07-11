#!/usr/bin/env node
/**
 * WF-E3 — tool-name collision: both the `email` and `gmail` skills expose a
 * tool literally named `send_email`. docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: an employee with ONLY `gmail` assigned (no `email` skill at all)
 * resolves a chat tool_call to skillKey:'gmail' — NOT the unassigned `email`
 * skill (which is what the OLD, buggy global-catalog search would have
 * returned, since `email` happens to sort first in the catalog).
 */
import {
  section, info, assert, summary, freshCompany, hire, installSkill,
  assignSkill, chat, closePrompt,
} from '../lib/harness.mjs';

section('WF-E3: tool-name collision resolves to the ASSIGNED skill');

const { client } = await freshCompany('WF-E3');

const gmailSkill = await installSkill(client, 'gmail');
const employee = await hire(client, { name: 'GmailOnly', role: 'SUPPORT' });
await assignSkill(client, employee.id, gmailSkill.id); // ONLY gmail, never `email`

// This test's SUBJECT is skillKey-resolution, not "does the model decide to
// act" — real GPT is probabilistic and occasionally declines/asks first even
// on a fully-specified request (the same variability documented across the
// support/hr/finance/pm/custom-roles scripts). Retry a few times so a stray
// non-attempt doesn't mask the actual thing being tested.
let toolCall;
for (let attempt = 1; attempt <= 3 && !toolCall; attempt += 1) {
  const res = await chat(
    client,
    employee.id,
    'Right now, send an email to test@example.com with subject "Hello" and body "Hello there" — do not ask me anything first, just send it.',
  );
  toolCall = res.toolCalls?.[0];
  if (!toolCall) info(`Attempt ${attempt}: no tool call yet, retrying...`);
}

assert(!!toolCall, 'the employee attempted a tool call (within 3 tries)', JSON.stringify(toolCall));
assert(
  toolCall?.skillKey === 'gmail',
  'resolved skillKey is "gmail" (the ONLY assigned skill) — not the unassigned "email" skill',
  toolCall?.skillKey,
);

summary();
closePrompt();
