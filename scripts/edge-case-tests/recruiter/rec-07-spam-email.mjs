#!/usr/bin/env node
/**
 * REC-07 — a routine, unrelated email lands in the inbox (spam/newsletter/
 * personal). docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * Claim (fixed this session): the `looksLikeApplication` condition means this
 * should NOT fire the recruiting workflow at all.
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-07: unrelated email should NOT trigger RecruitAI');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);
const since = Date.now();

await guide([
  'Send a routine, UNRELATED email to kashifhussain146@gmail.com.',
  'Subject: "Quick catch-up call this week?" Body: "Hey, are you free Thursday for a call?"',
  '(No attachment, no words like resume/cv/application/candidate/hiring/position.)',
]);

info('Watching for 20s to confirm this does NOT fire the recruiting workflow (expected: no run)...');
let fired = false;
try {
  await waitForNewRun(client, wf.id, connector.id, since, { tries: 5, delayMs: 4000 });
  fired = true;
} catch {
  fired = false;
}
assert(!fired, 'no recruiting run fired for the unrelated email (looksLikeApplication filter working)', fired ? 'a run fired!' : 'no run fired');

summary();
closePrompt();
