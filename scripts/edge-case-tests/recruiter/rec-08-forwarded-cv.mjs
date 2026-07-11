#!/usr/bin/env node
/**
 * REC-08 — a colleague FORWARDS a candidate's CV (the `From` header is the
 * forwarder, not the candidate). docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * KNOWN, NOT-FIXED GAP: the reject/shortlist email would go to the forwarder,
 * not the candidate. This script demonstrates the current (gappy) behavior —
 * it does not assert success, just shows you who the email actually goes to.
 */
import {
  section, info, warn, guide, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-08: forwarded CV (known gap — not fixed)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Forward a resume/CV to kashifhussain146@gmail.com from YOUR OWN inbox',
  '(subject will likely start with "Fwd:"), adding a note like "Thoughts on this one?".',
  'Use a resume describing 1-2 years experience so it auto-rejects (easy to see who got the email).',
]);

const run = await waitForNewRun(client, wf.id, connector.id, since);
info(`Run status: ${run.status}`);
const t3 = run.steps?.find((s) => s.nodeId === 't3');
info(`Reject-email "to" field the run actually used: ${JSON.stringify(t3?.output?.echoed?.to ?? t3?.input?.args?.to)}`);
warn('If that "to" is YOUR address (the forwarder), not the actual candidate\'s — that confirms the known gap: {{trigger.from}} is always the forwarder for a Fwd:, not the original applicant.');

closePrompt();
