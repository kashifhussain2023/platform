#!/usr/bin/env node
/**
 * WF-E2 — a TOOL_ACTION step targets a DEGRADED/DISCONNECTED connector.
 * docs/test-cases/01-workflow-engine-edge-cases.md
 *
 * Claim: the engine checks connector health BEFORE calling the skill and
 * fails the step with a clear "connector unavailable — quarantined" error,
 * instead of hammering a dead provider. There's no public API to force a
 * connector unhealthy (only real health probes do that), so this script
 * arranges the precondition via one direct SQL UPDATE (see dbExec's
 * docstring) and verifies the OUTCOME entirely through the real API.
 */
import {
  section, info, assert, summary, freshCompany, installSkill, createWorkflow,
  runWorkflow, waitForRunStatus, dbExec, closePrompt,
} from '../lib/harness.mjs';

section('WF-E2: TOOL_ACTION on a DEGRADED connector');

const { client, companyId } = await freshCompany('WF-E2');
const gmail = await installSkill(client, 'gmail');

info('Forcing the connector to DEGRADED (test-setup only — no public API for this)...');
await dbExec(
  `update "InstalledSkill" set "connectionStatus"='DEGRADED' where id='${gmail.id}' and "companyId"='${companyId}';`,
);

const wf = await createWorkflow(client, {
  name: 'WF-E2 test',
  definition: {
    nodes: [
      { id: 't1', type: 'TRIGGER', config: {} },
      {
        id: 'tool1', type: 'TOOL_ACTION',
        config: { skillKey: 'gmail', tool: 'send_email', args: { to: 'x@example.com', subject: 'x', body: 'x' } },
      },
    ],
    edges: [{ from: 't1', to: 'tool1' }],
  },
});

const run = await runWorkflow(client, wf.id, {});
const finished = await waitForRunStatus(client, run.id, ['COMPLETED', 'FAILED']);

assert(finished.status === 'FAILED', 'run FAILS cleanly instead of attempting the dead connector', finished.status);
assert(
  (finished.error ?? '').toLowerCase().includes('quarantined'),
  'error names the quarantine (connector unavailable)',
  finished.error,
);

summary();
closePrompt();
