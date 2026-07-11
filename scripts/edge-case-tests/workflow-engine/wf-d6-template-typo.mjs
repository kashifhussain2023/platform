#!/usr/bin/env node
/**
 * WF-D6 — a template references a context key that was never set (a typo).
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * This is a DOCUMENTED, NOT-FIXED gap: `resolveTemplate` silently resolves a
 * missing path to an empty string, with no warning anywhere. This script
 * demonstrates the actual (still-gappy) behavior rather than asserting it's
 * fine — read the NOTIFY step's message in the run to see the blank spot.
 */
import {
  section, info, warn, freshCompany, createWorkflow, runWorkflow,
  waitForRunStatus, closePrompt,
} from '../lib/harness.mjs';

section('WF-D6: template referencing a typo\'d/unset context key (known gap, not fixed)');

const { client } = await freshCompany('WF-D6');

const wf = await createWorkflow(client, {
  name: 'WF-D6 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      // "outputKey" is "policy" but the NOTIFY message typos it as "polic"
      { id: 'r1', type: 'RETRIEVE', config: { query: 'anything', outputKey: 'policy' } },
      { id: 'n1', type: 'NOTIFY', config: { message: 'Policy context was: [{{polic}}]' } },
    ],
    edges: [{ from: 't1', to: 'r1' }, { from: 'r1', to: 'n1' }],
  },
});

const run = await runWorkflow(client, wf.id, {});
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);
const notifyStep = finished.steps?.find((s) => s.nodeId === 'n1');

info(`Run status: ${finished.status}`);
info(`NOTIFY message rendered as: ${JSON.stringify(notifyStep?.output?.message)}`);
if ((notifyStep?.output?.message ?? '').includes('[]')) {
  warn('Confirmed: the typo\'d {{polic}} silently rendered as an empty string — no error anywhere.');
  warn('This is the gap as documented — not something this script fixes.');
}

closePrompt();
