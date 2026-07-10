#!/usr/bin/env node
/**
 * patch-recruit-reject.mjs — add an AUTO-REJECT REPLY to the candidate on the
 * FALSE (below-threshold) branch of the RecruitAI screening workflow.
 *
 * Before: c1(CONDITION) --false--> n2(NOTIFY log only)   [candidate hears nothing]
 * After:  c1(CONDITION) --false--> t3(gmail send_email to {{trigger.from}}) --> n2(NOTIFY)
 *
 * Idempotent: re-running detects t3 and leaves the definition unchanged.
 * Run from platform/apps/api so @prisma/client + DATABASE_URL resolve:
 *   cd apps/api && node ../../scripts/patch-recruit-reject.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require(process.env.PRISMA_CLIENT_PATH ?? '@prisma/client');

const WORKFLOW_ID = 'cmrf5ifg9000ncs6w6op01apq';
const prisma = new PrismaClient();

const REJECT_NODE = {
  id: 't3',
  type: 'TOOL_ACTION',
  config: {
    skillKey: 'gmail',
    tool: 'send_email',
    args: {
      to: '{{trigger.from}}',
      subject: 'Update on your application',
      body:
        'Dear Candidate,\n\n' +
        'Thank you for your interest and for sharing your CV with us. ' +
        'After an initial review of your profile against the requirements for this role, ' +
        'we are sorry to inform you that your application has not been shortlisted at this time.\n\n' +
        'We genuinely appreciate the time and effort you invested, and we encourage you to apply ' +
        'for future openings that align with your experience.\n\n' +
        'Warm regards,\nRecruiting Team',
    },
  },
};

async function main() {
  const wf = await prisma.workflow.findUnique({ where: { id: WORKFLOW_ID } });
  if (!wf) throw new Error(`Workflow ${WORKFLOW_ID} not found`);
  const def = wf.definition;
  const nodes = def.nodes ?? [];
  const edges = def.edges ?? [];

  if (nodes.some((n) => n.id === 't3')) {
    console.log('t3 already present — no change.');
    return;
  }

  nodes.push(REJECT_NODE);

  // Rewire the false branch: c1 --false--> t3 --> n2 (was c1 --false--> n2).
  const falseEdge = edges.find(
    (e) => e.from === 'c1' && e.to === 'n2' && e.branch === 'false',
  );
  if (!falseEdge) throw new Error('false edge c1->n2 not found');
  falseEdge.to = 't3';
  edges.push({ from: 't3', to: 'n2' });

  await prisma.workflow.update({
    where: { id: WORKFLOW_ID },
    data: { definition: { ...def, nodes, edges } },
  });

  console.log('Patched: c1 --false--> t3(gmail reject to candidate) --> n2');
  console.log('nodes:', nodes.map((n) => `${n.id}:${n.type}`).join(', '));
  console.log(
    'edges:',
    edges.map((e) => `${e.from}->${e.to}${e.branch ? `[${e.branch}]` : ''}`).join(', '),
  );
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
