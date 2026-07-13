#!/usr/bin/env node
/**
 * Creates/updates all 11 production workflows (definitions.mjs) on the real
 * Kashif Recruiting tenant. Idempotent by name: existing workflows get their
 * definition/trigger PATCHed in place rather than duplicated. Gmail-triggered
 * workflows are left DRAFT (activateByDefault:false) — see definitions.mjs
 * module doc for why. Everything else is activated.
 *
 * Run: node scripts/production-workflows/create-all.mjs
 */
import { section, info, warn, kashifCompany, createWorkflow, findWorkflowByName } from '../edge-case-tests/lib/harness.mjs';
import { WORKFLOWS } from './definitions.mjs';

section('Create/update all production workflows');

const { client } = await kashifCompany();

for (const wf of WORKFLOWS) {
  let workflow;
  try {
    workflow = await findWorkflowByName(client, wf.name);
    workflow = await client.patch(`/workflows/${workflow.id}`, {
      definition: wf.definition,
      triggerType: wf.triggerType,
      triggerConfig: wf.triggerConfig,
      expectedUpdatedAt: workflow.updatedAt,
    });
    info(`Updated "${wf.name}" -> ${workflow.id} (status ${workflow.status})`);
  } catch {
    workflow = await createWorkflow(client, {
      name: wf.name,
      description: wf.description,
      definition: wf.definition,
    });
    if (wf.triggerType !== 'MANUAL') {
      workflow = await client.patch(`/workflows/${workflow.id}`, {
        triggerType: wf.triggerType,
        triggerConfig: wf.triggerConfig,
        expectedUpdatedAt: workflow.updatedAt,
      });
    }
    info(`Created "${wf.name}" -> ${workflow.id}`);
  }

  if (wf.activateByDefault && workflow.status !== 'ACTIVE') {
    workflow = await client.post(`/workflows/${workflow.id}/activate`);
    info(`  Activated.`);
  } else if (!wf.activateByDefault) {
    info(`  Left as ${workflow.status} (not auto-activated) — ${wf.notes ?? ''}`);
  }
}

warn('Gmail-triggered workflows ("Candidate Resume Screening (Production)" and "Production Test (AI Recruiter)") were left DRAFT — activating more than one Gmail-triggered workflow at a time causes every real inbound candidate email to fire ALL of them (duplicate scoring/sends). Deactivate the existing RecruitAI workflow before activating either one.');
info('Done.');
