#!/usr/bin/env node
/**
 * WF-D2 — a node with no incoming edge (unreachable from TRIGGER).
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: the save SUCCEEDS (non-blocking) but the response's `warnings[]`
 * names the dead step, so the builder can show it instead of silently
 * shipping dead code.
 */
import {
  section, assert, summary, freshCompany, createWorkflow, closePrompt,
} from '../lib/harness.mjs';

section('WF-D2: orphaned (unreachable) workflow node');

const { client } = await freshCompany('WF-D2');

const wf = await createWorkflow(client, {
  name: 'WF-D2 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      { id: 'n1', type: 'NOTIFY', name: 'Reachable', config: { message: 'ok' } },
      { id: 'n2', type: 'NOTIFY', name: 'Orphaned', config: { message: 'dead' } },
    ],
    edges: [{ from: 't1', to: 'n1' }], // n2 has no incoming edge
  },
});

assert(wf.status !== undefined, 'save SUCCEEDS despite the orphaned node (non-blocking)', wf.status);
assert(
  wf.warnings.some((w) => w.includes('Orphaned')),
  'warnings[] names the orphaned step',
  JSON.stringify(wf.warnings),
);

summary();
closePrompt();
