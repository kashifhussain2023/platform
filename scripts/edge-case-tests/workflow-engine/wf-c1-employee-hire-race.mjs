#!/usr/bin/env node
/**
 * WF-C1 — employee hiring at the subscription seat limit under concurrency
 * (reference case; fixed in the billing-gating session, see
 * docs/specs/hiring-and-subscription-linkage.md). Included here as the
 * canonical "race-safe" pattern this codebase follows.
 *
 * Claim: a STARTER plan (2-seat limit) at 1-of-2 gets 5 CONCURRENT hire
 * requests -> exactly 1 succeeds, 4 are correctly blocked.
 */
import {
  section, info, assert, summary, freshCompany, hire, closePrompt, BASE,
} from '../lib/harness.mjs';

section('WF-C1: concurrent employee hires at the seat-limit boundary');

const { client } = await freshCompany('WF-C1');

info('Hiring employee #1 (fills 1-of-2 on the default STARTER plan)...');
await hire(client, { name: 'E1', role: 'SUPPORT' });

info('Firing 5 CONCURRENT hire requests (only 1 more seat available)...');
const token = client.getToken();
const results = await Promise.all(
  [1, 2, 3, 4, 5].map((i) =>
    fetch(`${BASE}/employees`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Race${i}`, role: 'SUPPORT' }),
    }).then((r) => ({ i, status: r.status })),
  ),
);
results.forEach((r) => info(`  req${r.i}: HTTP ${r.status}`));

const succeeded = results.filter((r) => r.status === 201);
const blocked = results.filter((r) => r.status === 403);
assert(succeeded.length === 1, 'exactly 1 hire succeeded', `${succeeded.length} succeeded`);
assert(blocked.length === 4, 'the other 4 correctly got 403 (seat limit)', `${blocked.length} blocked`);

summary();
closePrompt();
