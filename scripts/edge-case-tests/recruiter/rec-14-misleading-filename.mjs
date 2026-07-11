#!/usr/bin/env node
/**
 * REC-14 — a PDF resume named misleadingly (e.g. "invoice.pdf").
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * Claim: classification is by MIME type, not filename — a misleadingly-named
 * PDF still gets its text extracted correctly.
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-14: PDF resume with a misleading filename');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email TO kashifhussain146@gmail.com with a REAL PDF resume (strong candidate, 8+ years)',
  'but save/rename the file to something misleading like "invoice.pdf" before attaching it.',
  'Subject: "Application: Senior Backend Engineer"',
]);

const run = await waitForNewRun(client, wf.id, connector.id, since);
const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
info(`Score: ${scoreStep?.output?.text}`);
assert(
  !(run.trigger?.attachments ?? []).some((a) => a.skipped),
  'the misleadingly-named PDF was NOT skipped (content-type based, not filename based)',
  JSON.stringify(run.trigger?.attachments),
);
assert(Number(scoreStep?.output?.text) > 50, 'scored based on actual content, despite the filename', scoreStep?.output?.text);

summary();
closePrompt();
