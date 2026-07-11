#!/usr/bin/env node
/**
 * REC-09 — kashifhussain146@gmail.com is CC'd, not the direct To recipient.
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-09: kashifhussain146@gmail.com in Cc, not To');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email with kashifhussain146@gmail.com in the Cc field (To someone else, e.g. yourself).',
  'Subject: "Application: Backend Engineer". Body/attachment: a resume of your choice.',
]);

const run = await waitForNewRun(client, wf.id, connector.id, since);
assert(!!run, 'a run fired even though the address was Cc\'d, not To\'d', run.status);
info(`Run status: ${run.status} — inbound detection is "any new message in this mailbox," regardless of To/Cc.`);

summary();
closePrompt();
