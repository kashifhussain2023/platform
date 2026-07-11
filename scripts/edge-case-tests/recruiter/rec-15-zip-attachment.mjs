#!/usr/bin/env node
/**
 * REC-15 — a resume delivered as a ZIP attachment.
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * KNOWN, NOT-FIXED GAP: only PDF/DOCX/plain-text attachments are extracted —
 * a zipped resume is invisible to the scorer. Demonstrates the gap, does not
 * assert success.
 */
import {
  section, info, warn, guide, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-15: resume inside a ZIP attachment (known gap — not fixed)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Zip a strong resume (e.g. resume.pdf -> resume.zip) and email the .zip TO kashifhussain146@gmail.com.',
  'Subject: "Application: Senior Backend Engineer (zipped resume)"',
]);

const run = await waitForNewRun(client, wf.id, connector.id, since);
const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
info(`Score: ${scoreStep?.output?.text} (run ${run.status})`);
info(`trigger.attachments: ${JSON.stringify(run.trigger?.attachments)}`);
warn('Expected (the gap): the .zip is skipped as an unsupported file type — the resume inside it is completely invisible to the scorer.');

closePrompt();
