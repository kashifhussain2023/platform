#!/usr/bin/env node
/**
 * REC-05 — multiple candidates arriving within the same poll window.
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, sleep, closePrompt,
} from '../lib/harness.mjs';

section('REC-05: 3 candidates in quick succession');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Within the next 30 seconds, send 3 SEPARATE emails to kashifhussain146@gmail.com,',
  'from 3 different addresses (or 3 different subjects if same address), each',
  'with subject like "Application: Candidate A/B/C" and a resume/body of your choice.',
  'Send all 3 BEFORE pressing Enter (don\'t wait for the first to process).',
]);

info('Waiting a moment for all 3 to land, then polling the connector...');
await sleep(3000);

const runs = [];
const seen = new Set();
for (let i = 0; i < 3; i += 1) {
  const run = await waitForNewRun(client, wf.id, connector.id, since, { tries: 20, excludeIds: seen });
  seen.add(run.id);
  runs.push(run);
}
assert(new Set(runs.map((r) => r.id)).size === 3, 'all 3 candidates produced 3 DISTINCT runs', runs.map((r) => r.id).join(', '));
runs.forEach((r, i) => info(`Candidate ${i + 1}: run ${r.id}, status ${r.status}`));

summary();
closePrompt();
