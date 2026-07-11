#!/usr/bin/env node
/**
 * REC-03 — score exactly at the current Hiring Policy's stated minimum.
 * docs/test-cases/02-ai-recruiter-edge-cases.md
 *
 * LLM scoring is not perfectly deterministic — this script sends the SAME
 * borderline CV 3 times and shows you the score each time, so you can see
 * the actual variance instead of assuming determinism.
 */
import {
  section, info, guide, kashifCompany, findWorkflowByName,
  findGmailConnector, waitForNewRun, closePrompt,
} from '../lib/harness.mjs';

section('REC-03: score variance at the policy\'s stated minimum (run 3x)');

const { client } = await kashifCompany();
const wf = await findWorkflowByName(client, 'candidate email');
const connector = await findGmailConnector(client);

const policyDoc = await client.get('/knowledge/documents');
info('Check your current Hiring Policy doc\'s stated minimum years before you write the CV:');
info(JSON.stringify(policyDoc.map((d) => d.filename)));

const scores = [];
for (let round = 1; round <= 3; round += 1) {
  const since = Date.now();
  await guide([
    `Round ${round}/3 — send an email TO kashifhussain146@gmail.com.`,
    'Subject: "Application: Senior Backend Engineer"',
    'CV/body: state EXACTLY the years of experience your policy requires as the minimum (nothing more).',
  ]);
  const run = await waitForNewRun(client, wf.id, connector.id, since);
  const scoreStep = run.steps?.find((s) => s.nodeId === 'a1');
  scores.push(scoreStep?.output?.text);
  info(`Round ${round} score: ${scoreStep?.output?.text} (run ${run.status})`);
}

info(`All 3 scores: ${scores.join(', ')}`);
info('No pass/fail here — eyeball whether these 3 scores cluster tightly around the threshold or swing wildly.');
closePrompt();
