#!/usr/bin/env node
/**
 * WF-C2 — two edits to the same workflow with a stale `expectedUpdatedAt`.
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: a stale timestamp -> 409 (someone else saved in between); a fresh,
 * correct timestamp -> 200. Both must be true (no false positives either).
 */
import {
  section, assert, summary, freshCompany, createWorkflow, closePrompt,
} from '../lib/harness.mjs';

section('WF-C2: optimistic-concurrency conflict on workflow Save');

const { client } = await freshCompany('WF-C2');

const wf = await createWorkflow(client, { name: 'WF-C2 test' });

let staleStatus;
try {
  await client.patch(`/workflows/${wf.id}`, {
    name: 'Renamed (stale)',
    expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
  }, { raw: true }).then((r) => (staleStatus = r.status));
} catch (err) {
  staleStatus = err.status;
}
assert(staleStatus === 409, 'a STALE expectedUpdatedAt is rejected with 409', `got ${staleStatus}`);

const fresh = await client.get(`/workflows/${wf.id}`);
const okRes = await client.patch(`/workflows/${wf.id}`, {
  name: 'Renamed (fresh)',
  expectedUpdatedAt: fresh.updatedAt,
}, { raw: true });
assert(okRes.status === 200, 'a FRESH/correct expectedUpdatedAt succeeds (no false-positive conflict)', `got ${okRes.status}`);

summary();
closePrompt();
