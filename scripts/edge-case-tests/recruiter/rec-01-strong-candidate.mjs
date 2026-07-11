#!/usr/bin/env node
/**
 * REC-01 — strong candidate (score > 79). docs/test-cases/02-ai-recruiter-edge-cases.md
 * Real email required — this script GUIDES you through sending it, then
 * watches the real RecruitAI workflow for the outcome.
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-01: strong candidate (expect score > 79 -> Approval)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email TO kashifhussain146@gmail.com (from any other address).',
  'Subject: "Application: Senior Backend Engineer"',
  'Attach a PDF resume (or paste in the body) describing 7+ years of relevant backend experience.',
]);

info('Watching for the new run (polling the connector now)...');
const run = await waitForNewRun(client, wf.id, connector.id, since);

info(`Run status: ${run.status}`);
const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
info(`AI score: ${scoreStep?.output?.text}`);
assert(run.status === 'WAITING', 'run reached WAITING (Approval) — the CONDITION took the true branch', run.status);
info('Check /approvals in the web app — you should see this candidate with the score shown, awaiting your decision.');

summary();
closePrompt();
