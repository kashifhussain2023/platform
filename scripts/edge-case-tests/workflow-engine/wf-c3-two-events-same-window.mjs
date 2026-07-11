#!/usr/bin/env node
/**
 * WF-C3 — two distinct inbound messages "in the same poll window" should each
 * fire INDEPENDENTLY (dedupe is per Gmail messageId, not per poll cycle).
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Simulated here via two direct fireEvent calls with distinct eventIds (the
 * real Gmail driver's dedupeKey is `gmail:msg:<id>` — this proves the
 * downstream fan-out logic fires once per distinct event, not once per poll).
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, sleep,
  closePrompt,
} from '../lib/harness.mjs';

section('WF-C3: two distinct events in one "poll window" fire independently');

const { client } = await freshCompany('WF-C3');

// CreateWorkflowDto only takes name/description/definition — status/trigger
// are set via PATCH + a separate activate call.
const wf = await createWorkflow(client, {
  name: 'WF-C3 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'n1', type: 'NOTIFY', config: { message: 'fired for {{trigger.messageId}}' } },
    ],
    edges: [{ from: 't1', to: 'n1' }],
  },
});
await client.patch(`/workflows/${wf.id}`, {
  triggerType: 'EVENT',
  triggerConfig: { eventType: 'NEW_EMAIL' },
});
await client.post(`/workflows/${wf.id}/activate`, {});

info('Firing event #1 (simulated candidate email, messageId=aaa)...');
const r1 = await client.post('/workflows/events', {
  eventType: 'NEW_EMAIL',
  payload: { messageId: 'aaa', from: 'cand1@example.com' },
});
info('Firing event #2 (a DIFFERENT candidate email, messageId=bbb, arriving moments later)...');
const r2 = await client.post('/workflows/events', {
  eventType: 'NEW_EMAIL',
  payload: { messageId: 'bbb', from: 'cand2@example.com' },
});

assert(r1.count === 1, 'event #1 fired its own run', `count=${r1.count}`);
assert(r2.count === 1, 'event #2 (distinct message) ALSO fired its own run', `count=${r2.count}`);
assert(
  r1.runIds[0] !== r2.runIds[0],
  'the two runs are genuinely distinct (not deduped against each other)',
  `${r1.runIds[0]} vs ${r2.runIds[0]}`,
);

summary();
closePrompt();
