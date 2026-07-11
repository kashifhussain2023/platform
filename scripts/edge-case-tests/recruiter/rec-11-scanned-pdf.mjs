#!/usr/bin/env node
/**
 * REC-11 — a scanned/photographed resume (image-only PDF, no text layer).
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * KNOWN, NOT-FIXED GAP: no OCR — this demonstrates the current behavior
 * (scored on body/subject alone, CV text empty) rather than asserting success.
 */
import {
  section, info, warn, guide, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-11: scanned/image-only PDF resume (known gap — no OCR)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email TO kashifhussain146@gmail.com with a PDF that is a PHOTO/SCAN',
  '(no selectable text) of a strong resume — e.g. take a phone photo of a printed CV and save as PDF.',
  'Subject: "Application: Senior Backend Engineer (scanned)". Leave the body empty.',
]);

const run = await waitForNewRun(client, wf.id, connector.id, since);
const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
info(`Score: ${scoreStep?.output?.text} (run ${run.status})`);
warn('Expected (the gap): the score reflects the EMPTY body/subject only — the scanned resume\'s actual content was invisible to the model, likely scoring low regardless of the candidate\'s real qualifications.');

closePrompt();
