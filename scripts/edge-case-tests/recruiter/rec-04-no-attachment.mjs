#!/usr/bin/env node
/**
 * REC-04 — no attachment at all (CV described only in the email body).
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * NOTE: since the REC-07 fix, the `looksLikeApplication` condition requires
 * EITHER an attachment OR application-ish keywords in the subject/body — make
 * sure your body text below actually says words like "resume"/"application"
 * so this fires at all.
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-04: no attachment, CV described in the body only');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email TO kashifhussain146@gmail.com — NO attachment.',
  'Subject: "My application for the Senior Backend role"',
  'Body: describe your experience in plain text (e.g. "I have 8 years of backend experience with Node.js and PostgreSQL. Please consider my application.").',
]);

info('Watching for the new run...');
const run = await waitForNewRun(client, wf.id, connector.id, since);

const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
assert(!!scoreStep, 'the AI_STEP actually ran (scoring worked off body text alone)', scoreStep?.output?.text);
info(`Score: ${scoreStep?.output?.text}, run status: ${run.status}`);

summary();
closePrompt();
