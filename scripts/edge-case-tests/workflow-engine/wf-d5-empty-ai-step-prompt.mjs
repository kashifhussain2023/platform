#!/usr/bin/env node
/**
 * WF-D5 — an AI_STEP with a blank prompt. docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: falls back to a literal "Proceed." prompt rather than crashing —
 * avoids a hard failure, but is a low-value model call with nothing warning
 * you it happened. NOTE: this calls whatever LLM_PROVIDER the running API is
 * configured with (may be real OpenAI — one real API call).
 */
import {
  section, info, assert, summary, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-D5: AI_STEP with an empty prompt');

const { client } = await freshCompany('WF-D5');

const wf = await createWorkflow(client, {
  name: 'WF-D5 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'a1', type: 'AI_STEP', config: { prompt: '', outputKey: 'result' } },
    ],
    edges: [{ from: 't1', to: 'a1' }],
  },
});

const run = await runWorkflow(client, wf.id, {});
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);

assert(finished.status === 'COMPLETED', 'run completes, does not crash on an empty prompt', finished.status);
const step = finished.steps?.find((s) => s.nodeId === 'a1');
assert(step?.input?.prompt === '', 'the configured prompt really was blank (config.prompt="")', JSON.stringify(step?.input?.prompt));
// output.prompt records the ORIGINAL (blank) config, not what was actually
// SENT to the LLM — the "Proceed." fallback only affects the model call
// itself, so the tell is an on-topic-but-confused reply like the one below.
info(`Model replied: ${JSON.stringify(step?.output?.text)?.slice(0, 200)}`);
info('(A reply like "proceed with what?" is the model having actually received the literal "Proceed." fallback text.)');
info('Nothing anywhere flags that this was a low-value/nonsensical call — a documented, not-fixed gap.');

summary();
closePrompt();
