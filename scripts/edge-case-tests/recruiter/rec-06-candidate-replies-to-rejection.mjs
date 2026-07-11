#!/usr/bin/env node
/**
 * REC-06 — a candidate replies to their OWN rejection email.
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * This is a 2-part scenario: first get a real rejection (weak CV), THEN
 * reply to it from the candidate's inbox. Needs access to the CANDIDATE'S
 * inbox (the one you send the weak CV from) to hit Reply.
 */
import {
  section, info, guide, assert, summary, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-06: candidate replies to their own rejection (should NOT re-fire)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);

const since1 = Date.now();
await guide([
  'Step 1/2 — send a WEAK application (so it gets auto-rejected) to kashifhussain146@gmail.com,',
  'from an inbox you can reply from. Subject: "Application: Backend Role". Body: "1 year experience".',
]);
const rejectRun = await waitForNewRun(client, wf.id, connector.id, since1);
assert(rejectRun.status === 'COMPLETED', 'the weak CV was auto-rejected (a real rejection email was sent to you)', rejectRun.status);

const since2 = Date.now();
await guide([
  'Step 2/2 — open the REJECTION EMAIL you just received in that same inbox, hit REPLY,',
  'and send something like "Thank you for letting me know" back to kashifhussain146@gmail.com.',
]);

info('Watching for 20s to confirm NO new run fires for this reply (expected: none)...');
let firedForReply = false;
try {
  await waitForNewRun(client, wf.id, connector.id, since2, { tries: 5, delayMs: 4000 });
  firedForReply = true;
} catch {
  firedForReply = false;
}
assert(!firedForReply, 'the reply did NOT fire a new workflow run (thread-reply skip)', firedForReply ? 'a run fired!' : 'no run fired');

summary();
closePrompt();
