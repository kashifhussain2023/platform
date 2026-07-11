#!/usr/bin/env node
/**
 * REC-13 — an attachment over the 5MB size cap (fixed this session — the
 * skip is now visible, not just a server log line).
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-13: attachment over the 5MB cap (fixed — now visible in the run)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send an email TO kashifhussain146@gmail.com with a PDF resume LARGER than 5MB',
  '(e.g. embed several high-res photos in the PDF to bulk it up). Subject: "Application: Backend Engineer".',
]);

const run = await waitForNewRun(client, wf.id, connector.id, since);
const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
info(`Score: ${scoreStep?.output?.text} (run ${run.status})`);
info(`Prompt included: ${JSON.stringify(scoreStep?.input?.prompt)?.slice(0, 400)}`);
// The attachments array (surfaced on the trigger payload) should show it
// skipped, with a reason — check the run's original trigger.
info(`trigger.attachments: ${JSON.stringify(run.trigger?.attachments)}`);
assert(
  (run.trigger?.attachments ?? []).some((a) => a.skipped && /size cap/i.test(a.skipReason ?? '')),
  'the oversized attachment is recorded as skipped with a size-cap reason (not silently gone)',
  JSON.stringify(run.trigger?.attachments),
);

summary();
closePrompt();
