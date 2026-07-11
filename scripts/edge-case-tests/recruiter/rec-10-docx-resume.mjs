#!/usr/bin/env node
/**
 * REC-10 — a DOCX resume (fixed this session — mammoth added).
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-10: DOCX resume attachment (fixed — mammoth)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email TO kashifhussain146@gmail.com with a .docx resume attached',
  '(NOT PDF) describing 8+ years of relevant backend experience.',
  'Subject: "Application: Senior Backend Engineer (DOCX resume)"',
]);

const run = await waitForNewRun(client, wf.id, connector.id, since);
const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
info(`Prompt sent to the model included CV text: ${JSON.stringify(scoreStep?.input?.prompt)?.includes('CV:') ? 'yes (check it is non-empty below)' : 'unknown'}`);
info(`Score: ${scoreStep?.output?.text}`);
assert(
  Number(scoreStep?.output?.text) > 50,
  'a strong DOCX resume scored reasonably high (its content WAS read, not ignored)',
  scoreStep?.output?.text,
);

summary();
closePrompt();
