#!/usr/bin/env node
/**
 * REC-02 — weak candidate (score <= 79). docs/test-cases/02-ai-recruiter-edge-cases.md
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-02: weak candidate (expect score <= 79 -> auto-reject, real email sent)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email TO kashifhussain146@gmail.com (from any other address).',
  'Subject: "Application: Junior Backend Role"',
  'Attach a PDF resume (or paste in the body) describing only 1-2 years of experience.',
]);

info('Watching for the new run (polling the connector now)...');
const run = await waitForNewRun(client, wf.id, connector.id, since);

const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
info(`AI score: ${scoreStep?.output?.text}`);
assert(run.status === 'COMPLETED', 'run COMPLETED (auto-reject branch, no approval needed)', run.status);
info('Check the SENDER inbox — a polite rejection email should have actually arrived there.');

summary();
closePrompt();
