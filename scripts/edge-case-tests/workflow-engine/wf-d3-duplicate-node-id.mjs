#!/usr/bin/env node
/**
 * WF-D3 — duplicate node ids, and an edge referencing an unknown node id.
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: BOTH are rejected at save time with 400, instead of silently
 * corrupting the graph (a duplicate id would let the LAST one win in a Map;
 * an unknown edge target would make a run silently stop early).
 */
import { section, assert, summary, freshCompany, closePrompt } from '../lib/harness.mjs';

section('WF-D3: duplicate node id / unknown edge reference');

const { client } = await freshCompany('WF-D3');

let dupStatus, dupBody;
try {
  await client.post('/workflows', {
    name: 'Dup id test',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', config: {} },
        { id: 't1', type: 'NOTIFY', config: { message: 'x' } }, // duplicate "t1"
      ],
      edges: [],
    },
  });
} catch (err) {
  dupStatus = err.status;
  dupBody = err.body;
}
assert(dupStatus === 400, 'duplicate node id rejected with 400', JSON.stringify(dupBody));

let edgeStatus, edgeBody;
try {
  await client.post('/workflows', {
    name: 'Bad edge test',
    definition: {
      nodes: [{ id: 't1', type: 'TRIGGER', config: {} }],
      edges: [{ from: 't1', to: 'ghost' }], // "ghost" doesn't exist
    },
  });
} catch (err) {
  edgeStatus = err.status;
  edgeBody = err.body;
}
assert(edgeStatus === 400, 'edge to an unknown node id rejected with 400', JSON.stringify(edgeBody));

summary();
closePrompt();
