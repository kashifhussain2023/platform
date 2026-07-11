#!/usr/bin/env node
/**
 * REC-16 — a non-English CV/email (e.g. Hindi). docs/test-cases/02-ai-recruiter-edge-cases.md
 * Untested claim: GPT should still score reasonably (it's multilingual).
 */
import {
  section, info, guide, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-16: non-English (Hindi) CV/email');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email TO kashifhussain146@gmail.com written in Hindi (subject + body),',
  'describing a strong backend engineering candidate (7+ years experience).',
  'No attachment needed — body text is enough.',
]);

const run = await waitForNewRun(client, wf.id, connector.id, since);
const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
info(`Score: ${scoreStep?.output?.text} (run ${run.status})`);
info('No pass/fail threshold — eyeball whether the score sensibly reflects a strong candidate despite the non-English text.');

closePrompt();
