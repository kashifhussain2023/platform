#!/usr/bin/env node
/**
 * REC-12 — the same candidate applies twice (e.g. an updated CV a week
 * later). docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * Signal added this session (not full de-dup): {{trigger.isRepeatSender}} /
 * {{trigger.priorSubmissionCount}} on the SECOND submission from the same
 * address. This script checks that signal, via the CanonicalEvent's data
 * (the run's trigger payload isn't stored verbatim on WorkflowRun, so we read
 * the canonical event that fired it).
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-12: same candidate applies twice — repeat-sender signal');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);

const since1 = Date.now();
await guide([
  'Round 1/2 — send a CV to kashifhussain146@gmail.com from an address you control.',
  'Subject: "Application: Backend Role". Body: "2 years experience".',
]);
await waitForNewRun(client, wf.id, connector.id, since1);

const since2 = Date.now();
await guide([
  'Round 2/2 — from the SAME address, send an UPDATED CV a moment later.',
  'Subject: "Application: Backend Role (updated)". Body: "Actually I have 8 years experience".',
]);
const run2 = await waitForNewRun(client, wf.id, connector.id, since2);

info(`Run #2 status: ${run2.status}`);
info(`Run #2 trigger.isRepeatSender: ${run2.trigger?.isRepeatSender}`);
info(`Run #2 trigger.priorSubmissionCount: ${run2.trigger?.priorSubmissionCount}`);
assert(run2.trigger?.isRepeatSender === true, 'the SECOND submission is flagged isRepeatSender:true', run2.trigger?.isRepeatSender);
assert(
  Number(run2.trigger?.priorSubmissionCount) >= 1,
  'priorSubmissionCount reflects at least the 1 earlier submission',
  run2.trigger?.priorSubmissionCount,
);
info('Note: this is a SIGNAL only — no automatic de-dup/merge. Both submissions still get their own independent score/approval.');

summary();
closePrompt();
