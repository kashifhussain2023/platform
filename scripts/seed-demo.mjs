#!/usr/bin/env node
/**
 * seed-demo.mjs — drives the REAL V-AEP HTTP API (offline mock providers) to
 * create a complete DEMO COMPANY ("Acme Talent Inc") that exercises every module,
 * with a completed AI Recruitment (RecruitAI) scenario.
 *
 * Node 22 (global fetch/FormData/Blob), ESM. Re-runnable: a unique suffix
 * (default Date.now()) is used for the company slug + login emails so each run
 * produces a fresh, isolated tenant.
 *
 * Usage:
 *   node scripts/seed-demo.mjs [suffix] [baseUrl]
 *   BASE=http://localhost:4000 node scripts/seed-demo.mjs
 *
 * The API must already be listening (see platform/CLAUDE.md for the boot env).
 */

const BASE = process.argv[3] || process.env.BASE || 'http://localhost:4000';
const SUFFIX = process.argv[2] || String(Date.now());
const PASSWORD = 'Password123!';

// ---------------------------------------------------------------------------
// tiny HTTP helpers
// ---------------------------------------------------------------------------
let TOKEN = null;

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function req(method, path, body, { token, raw } = {}) {
  const headers = {};
  const useToken = token !== undefined ? token : TOKEN;
  if (useToken) headers.Authorization = `Bearer ${useToken}`;
  let payload;
  if (body instanceof FormData) {
    payload = body; // let fetch set multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status} ${res.statusText}: ${
        typeof json === 'string' ? json : JSON.stringify(json)
      }`,
    );
  }
  return raw ? { status: res.status, json } : json;
}

const get = (p, o) => req('GET', p, undefined, o);
const post = (p, b, o) => req('POST', p, b, o);
const patch = (p, b, o) => req('PATCH', p, b, o);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, { tries = 40, delayMs = 500, label = 'condition' } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const result = await fn();
    if (result !== undefined && result !== null && result !== false) return result;
    await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const log = (...a) => console.log(...a);
const step = (n, t) => log(`\n=== ${n}. ${t} ===`);

// running summary
const summary = {};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  log(`V-AEP demo seed  base=${BASE}  suffix=${SUFFIX}`);
  const email = (local) => `${local}+${SUFFIX}@acme.demo`;
  const ownerEmail = email('owner');
  const adminEmail = email('recruit.admin');
  const managerEmail = email('hiring.manager');

  // ---- 1. Register organization + owner --------------------------------
  step(1, 'Register organization + owner (STARTER auto-subscription)');
  const reg = await post('/auth/register', {
    companyName: 'Acme Talent Inc',
    name: 'Acme Owner',
    email: ownerEmail,
    password: PASSWORD,
    industry: 'Staffing & Recruiting',
    size: '11-50',
    country: 'United States',
    timezone: 'America/New_York',
    website: 'https://acme-talent.demo',
    description: 'A staffing & recruiting agency piloting managed AI Employees.',
  });
  TOKEN = reg.tokens.accessToken;
  const companyId = reg.company.id;
  const ownerId = reg.user.id;
  log(`  company=${reg.company.name} id=${companyId} slug=${reg.company.slug}`);
  log(`  owner=${reg.user.email} role=${reg.user.role}`);
  summary.company = { name: reg.company.name, id: companyId, slug: reg.company.slug };
  summary.owner = ownerEmail;

  // ---- 2. Company profile ---------------------------------------------
  step(2, 'Company profile (PATCH /companies/current)');
  const company = await patch('/companies/current', {
    industry: 'Staffing & Recruiting',
    size: '11-50',
    country: 'United States',
    timezone: 'America/New_York',
    website: 'https://acme-talent.demo',
    description:
      'Acme Talent Inc places senior engineers. Piloting V-AEP AI Employees to accelerate hiring.',
  });
  log(`  industry=${company.industry} size=${company.size} tz=${company.timezone}`);

  // ---- 3. Team (User Management) --------------------------------------
  step(3, 'Team / User Management (create ADMIN + MEMBER, verify logins)');
  const admin = await post('/users', {
    email: adminEmail,
    name: 'Recruit Admin',
    role: 'ADMIN',
    password: PASSWORD,
  });
  const manager = await post('/users', {
    email: managerEmail,
    name: 'Hiring Manager',
    role: 'MEMBER',
    password: PASSWORD,
  });
  log(`  created ADMIN=${admin.email} (${admin.id})`);
  log(`  created MEMBER=${manager.email} (${manager.id})`);
  // verify each can log in
  const adminLogin = await post('/auth/login', { email: adminEmail, password: PASSWORD }, { token: null });
  const managerLogin = await post('/auth/login', { email: managerEmail, password: PASSWORD }, { token: null });
  log(`  login ADMIN ok=${!!adminLogin.tokens.accessToken}  login MEMBER ok=${!!managerLogin.tokens.accessToken}`);
  const users = await get('/users');
  log(`  total users in company = ${users.length}`);
  summary.users = { total: users.length, admin: adminEmail, manager: managerEmail };

  // ---- 4. Organization structure -------------------------------------
  step(4, 'Organization structure (Departments, Team, Security Policy)');
  const deptPeople = await post('/departments', { name: 'People', description: 'Recruiting & HR' });
  const deptEng = await post('/departments', { name: 'Engineering', description: 'Product engineering' });
  const teamBackend = await post('/teams', { name: 'Backend Hiring', departmentId: deptEng.id });
  const policy = await patch('/security-policy', {
    passwordMinLength: 8,
    allowedEmailDomains: [],
    mfaRequired: false,
    sessionTimeoutMinutes: 480,
    dataRetentionDays: 365,
  });
  log(`  departments: People=${deptPeople.id} Engineering=${deptEng.id}`);
  log(`  team: Backend Hiring=${teamBackend.id} under dept=${teamBackend.departmentId}`);
  log(`  securityPolicy passwordMinLength=${policy.passwordMinLength} allowedEmailDomains=${JSON.stringify(policy.allowedEmailDomains)}`);
  summary.org = { departments: 2, team: 'Backend Hiring', policy: `minLen=${policy.passwordMinLength}` };

  // ---- 5. Billing -----------------------------------------------------
  step(5, 'Billing (assert STARTER, change to BUSINESS, usage)');
  const sub0 = await get('/billing/subscription');
  log(`  auto subscription plan=${sub0.plan} status=${sub0.status}`);
  if (sub0.plan !== 'STARTER') log(`  WARN expected STARTER, got ${sub0.plan}`);
  const subBiz = await post('/billing/subscription', { plan: 'BUSINESS' });
  log(`  changed plan -> ${subBiz.plan} status=${subBiz.status}`);
  const usage = await get('/billing/usage');
  log(`  usage plan=${usage.plan} maxEmployees=${usage.maxEmployees} employees=${usage.employees} installedSkills=${usage.installedSkills}`);
  summary.billing = { from: sub0.plan, to: subBiz.plan, maxEmployees: usage.maxEmployees };

  // ---- 6. Onboarding (stamp onboardedAt; hire none here) --------------
  step(6, 'Onboarding (complete: business + RECRUITMENT/HR departments)');
  const onboard = await post('/onboarding/complete', {
    business: {
      industry: 'Staffing & Recruiting',
      size: '11-50',
      description: 'AI-assisted senior engineering recruitment.',
    },
    departments: ['RECRUITMENT', 'HR'],
    employees: [], // hire via marketplace below (avoids duplicate RecruitAI)
  });
  log(`  onboardedAt=${onboard.company.onboardedAt} employeesHired=${onboard.employees.length}`);
  const onbStatus = await get('/onboarding/status');
  log(`  onboarding completed=${onbStatus.completed}`);
  summary.onboarding = { completed: onbStatus.completed, onboardedAt: onboard.company.onboardedAt };

  // ---- 7. Marketplace: install RecruitAI + a workflow template --------
  step(7, 'Marketplace (install RecruitAI employee + recruiting workflow template)');
  const market = await get('/marketplace');
  log(`  marketplace: employees=${market.employees.length} workflows=${market.workflows.length} skills=${market.skills.length}`);
  const recruit = await post('/marketplace/employees/recruit-ai/install', {});
  const employeeId = recruit.id;
  log(`  installed employee RecruitAI id=${employeeId} role=${recruit.role}`);
  const wfTemplate = await post('/marketplace/workflows/recruiting-resume-score-schedule/install', {});
  log(`  installed workflow template "${wfTemplate.name}" id=${wfTemplate.id}`);
  summary.marketplace = { employeeId, templateWorkflowId: wfTemplate.id };

  // ---- 8. Configure RecruitAI -----------------------------------------
  step(8, 'Configure RecruitAI (PATCH /employees/:id)');
  const configured = await patch(`/employees/${employeeId}`, {
    department: 'People',
    managerName: 'HR Head',
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    timezone: 'America/New_York',
    language: 'en',
    knowledgeAccess: 'ALL',
    budgetLimit: 5000,
    permissions: { sendEmail: true, scheduleMeeting: true },
    approvalRules: { requireApprovalForTools: ['slack:send_message'] },
    goals: ['Hire senior backend engineers within 3 weeks'],
    kpiTargets: { tasksPerWeek: 40, successRatePct: 80 },
    persona:
      'You are RecruitAI, a focused senior-backend technical recruiter for Acme Talent Inc. ' +
      'You ground answers in company hiring policy and escalate offer negotiation to the HR Head.',
  });
  log(`  dept=${configured.department} manager=${configured.managerName} hours=${configured.workingHoursStart}-${configured.workingHoursEnd}`);
  log(`  knowledgeAccess=${configured.knowledgeAccess} approvalRules=${JSON.stringify(configured.approvalRules)}`);
  log(`  goals=${JSON.stringify(configured.goals)} kpiTargets=${JSON.stringify(configured.kpiTargets)}`);
  summary.employee = {
    id: employeeId,
    approvalRules: configured.approvalRules,
    goals: configured.goals,
    kpiTargets: configured.kpiTargets,
  };

  // ---- 9. Knowledge (RAG): upload 2 docs, poll READY ------------------
  step(9, 'Knowledge (upload 2 docs, poll until READY)');
  const hiringPolicy = [
    'ACME TALENT — HIRING POLICY',
    '',
    'Minimum experience: candidates for senior backend roles must have at least 3 years',
    'of professional backend engineering experience.',
    '',
    'Salary bands (illustrative): Senior Backend Engineer USD 140,000 - 180,000 base.',
    'Staff Backend Engineer USD 180,000 - 220,000 base.',
    '',
    'Escalation: any offer negotiation beyond the published band must be escalated to the',
    'HR Head before any commitment is made to the candidate.',
    '',
    'Equal opportunity: Acme hires without regard to protected characteristics.',
  ].join('\n');
  const interviewProcess = [
    'ACME TALENT — INTERVIEW PROCESS',
    '',
    'Stage 1 Screening: 30-minute recruiter screen for experience and role fit.',
    'Stage 2 Technical Interview: live coding on backend fundamentals.',
    'Stage 3 System Design: architecture and scalability discussion for senior candidates.',
    'Stage 4 HR Round: compensation expectations, notice period, culture fit.',
    '',
    'Only candidates who clear all four stages proceed to an offer, subject to the hiring policy.',
  ].join('\n');

  async function upload(name, content) {
    const fd = new FormData();
    fd.append('file', new Blob([content], { type: 'text/plain' }), name);
    const doc = await post('/knowledge/documents', fd);
    log(`  uploaded ${name} id=${doc.id} status=${doc.status}`);
    return doc;
  }
  const docPolicy = await upload('Hiring-Policy.txt', hiringPolicy);
  const docProcess = await upload('Interview-Process.txt', interviewProcess);

  async function waitReady(id, label) {
    const doc = await poll(
      async () => {
        const d = await get(`/knowledge/documents/${id}`);
        if (d.status === 'READY') return d;
        if (d.status === 'FAILED') throw new Error(`${label} ingestion FAILED: ${d.error}`);
        return false;
      },
      { tries: 60, delayMs: 500, label: `${label} READY` },
    );
    log(`  ${label} READY chunks=${doc.chunkCount}`);
    return doc;
  }
  const readyPolicy = await waitReady(docPolicy.id, 'Hiring Policy');
  const readyProcess = await waitReady(docProcess.id, 'Interview Process');
  summary.knowledge = {
    docs: 2,
    chunks: readyPolicy.chunkCount + readyProcess.chunkCount,
  };

  // ---- 10. Grounded chat (BEFORE skills so it is a clean grounded turn) -
  step(10, 'Grounded chat with RecruitAI (cites uploaded knowledge)');
  const convA = await post(`/employees/${employeeId}/conversations`, { title: 'Hiring policy Q&A' });
  const groundedRun = await post(`/conversations/${convA.id}/messages`, {
    content: 'How do we hire a Senior Backend Developer? Use our policy.',
  });
  log(`  assistant: ${String(groundedRun.message.content).slice(0, 160)}...`);
  log(`  sources=${groundedRun.sources.length} grounded=${groundedRun.validation.grounded} confidence=${groundedRun.validation.confidence}`);
  if (groundedRun.sources.length === 0) throw new Error('Grounded chat returned no sources');
  summary.groundedChat = {
    conversationId: convA.id,
    sources: groundedRun.sources.length,
    grounded: groundedRun.validation.grounded,
  };

  // ---- 11. Skills: install / configure / connect / assign -------------
  step(11, 'Skills (install gmail/calendar/slack/http, configure, connect, assign)');
  const skillConfigs = {
    gmail: {
      config: {
        companyEmail: 'talent@acme-talent.demo',
        dailyEmailLimit: 200,
        signature: 'RecruitAI — Acme Talent Inc',
        businessHoursStart: '09:00',
        businessHoursEnd: '18:00',
        canSend: true,
        canRead: true,
      },
    },
    calendar: { config: { defaultCalendar: 'primary', timezone: 'America/New_York' } },
    slack: { config: { defaultChannel: '#hiring' } },
    http: { config: { baseUrl: 'https://ats.acme-talent.demo', authHeader: 'Bearer demo-ats-token' } },
  };
  const installedIds = {};
  for (const skillKey of ['gmail', 'calendar', 'slack', 'http']) {
    const inst = await post('/skills/install', { skillKey });
    installedIds[skillKey] = inst.id;
    await patch(`/skills/installed/${inst.id}/config`, skillConfigs[skillKey]);
    const connected = await post(`/skills/installed/${inst.id}/connect`, {
      credentials: { apiKey: `demo-${skillKey}-key-${SUFFIX}`, webhookSecret: `whsec_${skillKey}_${SUFFIX}` },
    });
    const assign = await post(`/employees/${employeeId}/skills`, { installedSkillId: inst.id });
    log(`  ${skillKey}: installed=${inst.id} connection=${connected.connectionStatus} assigned=${assign.id}`);
  }
  const installedList = await get('/skills/installed');
  const empSkills = await get(`/employees/${employeeId}/skills`);
  log(`  installed skills=${installedList.length} assigned to RecruitAI=${empSkills.length}`);
  summary.skills = { installed: installedList.length, assigned: empSkills.length };

  // ---- 12. Approval via chat (slack requires approval) ----------------
  step(12, 'Approval-gated chat (slack:send_message needs approval)');
  const convB = await post(`/employees/${employeeId}/conversations`, { title: 'Announce role on Slack' });
  const slackRun = await post(`/conversations/${convB.id}/messages`, {
    content: 'Post a message to #hiring in Slack announcing the Senior Backend role.',
  });
  const pendingCall = slackRun.toolCalls.find((tc) => tc.pendingApproval);
  if (!pendingCall) {
    throw new Error(
      `Expected a pendingApproval slack tool call, got: ${JSON.stringify(slackRun.toolCalls)}`,
    );
  }
  log(`  tool ${pendingCall.skillKey}.${pendingCall.tool} pendingApproval=${pendingCall.pendingApproval} approvalId=${pendingCall.approvalId} executed=${pendingCall.ok}`);
  // slack must NOT have executed yet
  const pendingList = await get('/approvals?status=PENDING');
  const chatApproval = pendingList.find((a) => a.id === pendingCall.approvalId);
  if (!chatApproval) throw new Error('PENDING chat approval not found in /approvals?status=PENDING');
  log(`  PENDING approvals=${pendingList.length}; approving ${chatApproval.id} (kind=${chatApproval.kind})`);
  const approvedChat = await post(`/approvals/${chatApproval.id}/approve`, { note: 'Approved by owner for demo' });
  log(`  chat approval status=${approvedChat.status} tool=${approvedChat.skillKey}.${approvedChat.tool}`);
  summary.chatApproval = { approvalId: chatApproval.id, status: approvedChat.status };

  // ---- 13. Workflow: build EVENT-triggered pipeline + activate --------
  step(13, 'Workflow (build TRIGGER->RETRIEVE->AI_STEP->APPROVAL->NOTIFY, activate)');
  const created = await post('/workflows', {
    name: 'New Candidate -> Screen -> Schedule',
    description: 'Screen a new candidate against hiring policy, gate on HR approval, notify hiring manager.',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'New candidate', config: {} },
        { id: 'r1', type: 'RETRIEVE', name: 'Policy lookup', config: { query: '{{trigger.role}} hiring policy', k: 5, outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'Score candidate', config: { prompt: 'Score candidate {{trigger.candidate}} for the {{trigger.role}} role using this policy context: {{policy}}', outputKey: 'score' } },
        { id: 'ap1', type: 'APPROVAL', name: 'HR approves interview', config: { message: 'HR approves interview for {{trigger.candidate}} ({{trigger.role}})?' } },
        { id: 'n1', type: 'NOTIFY', name: 'Notify hiring manager', config: { message: 'Hiring manager: {{trigger.candidate}} approved for {{trigger.role}}.' } },
      ],
      edges: [
        { from: 't1', to: 'r1' },
        { from: 'r1', to: 'a1' },
        { from: 'a1', to: 'ap1' },
        { from: 'ap1', to: 'n1' },
      ],
    },
  });
  await patch(`/workflows/${created.id}`, {
    triggerType: 'EVENT',
    triggerConfig: { eventType: 'NEW_CANDIDATE', conditions: [{ path: 'role', op: 'contains', value: 'Senior' }] },
  });
  const activated = await post(`/workflows/${created.id}/activate`, {});
  log(`  workflow id=${created.id} status=${activated.status} trigger=${activated.triggerType}`);
  summary.workflow = { id: created.id, status: activated.status };

  // ---- 14. Fire workflow -> WAITING -> approve -> COMPLETED -----------
  step(14, 'Fire workflow event, approve WAITING run, poll COMPLETED');
  const fired = await post('/workflows/events', {
    eventType: 'NEW_CANDIDATE',
    payload: { role: 'Senior Backend Developer', candidate: 'Jane Doe' },
  });
  log(`  fireEvent matched=${fired.count} runIds=${JSON.stringify(fired.runIds)}`);
  if (fired.count < 1) throw new Error('Workflow event matched no runs');
  const runId = fired.runIds[0];

  const waitingRun = await poll(
    async () => {
      const r = await get(`/workflows/runs/${runId}`);
      if (r.status === 'WAITING') return r;
      if (r.status === 'FAILED') throw new Error(`Run FAILED before WAITING: ${r.error}`);
      if (r.status === 'COMPLETED') throw new Error('Run COMPLETED without pausing at APPROVAL');
      return false;
    },
    { tries: 60, delayMs: 500, label: 'workflow run WAITING' },
  );
  log(`  run ${runId} reached status=${waitingRun.status}`);

  const wfApproval = await poll(
    async () => {
      const list = await get('/approvals?status=PENDING');
      return list.find((a) => a.kind === 'WORKFLOW' && a.workflowRunId === runId) || false;
    },
    { tries: 30, delayMs: 500, label: 'workflow PENDING approval' },
  );
  log(`  workflow approval id=${wfApproval.id} kind=${wfApproval.kind} runId=${wfApproval.workflowRunId}`);
  const wfApproved = await post(`/approvals/${wfApproval.id}/approve`, { note: 'HR approves interview' });
  log(`  workflow approval status=${wfApproved.status}`);

  const completedRun = await poll(
    async () => {
      const r = await get(`/workflows/runs/${runId}`);
      if (r.status === 'COMPLETED') return r;
      if (r.status === 'FAILED') throw new Error(`Run FAILED after approval: ${r.error}`);
      return false;
    },
    { tries: 60, delayMs: 500, label: 'workflow run COMPLETED' },
  );
  const steps = completedRun.steps || [];
  log(`  run ${runId} status=${completedRun.status} steps=${steps.map((s) => `${s.type}:${s.status}`).join(', ')}`);
  summary.workflowRun = {
    runId,
    status: completedRun.status,
    approvalId: wfApproval.id,
    steps: steps.map((s) => `${s.type}:${s.status}`),
  };

  // ---- 15. Analytics --------------------------------------------------
  step(15, 'Analytics (overview + employees)');
  const overview = await get('/analytics/overview?range=all');
  log(`  overview: employees=${overview.employees} toolActions=${overview.toolActions} conversations=${overview.conversations} assistantMessages=${overview.assistantMessages} workflowRuns=${overview.workflowRuns} workflowCompleted=${overview.workflowCompleted} tasksCompleted=${overview.tasksCompleted} successRate=${overview.successRate}`);
  const empAnalytics = await get('/analytics/employees?range=all');
  const recruitKpi = empAnalytics.find((e) => e.employeeId === employeeId);
  if (recruitKpi) {
    log(`  RecruitAI: toolActions=${recruitKpi.toolActions} conversations=${recruitKpi.conversations} assistantMessages=${recruitKpi.assistantMessages} tasksCompleted=${recruitKpi.tasksCompleted} pendingApprovals=${recruitKpi.pendingApprovals}`);
    log(`  RecruitAI attainment=${JSON.stringify(recruitKpi.attainment)}`);
  }
  summary.analytics = {
    employees: overview.employees,
    toolActions: overview.toolActions,
    conversations: overview.conversations,
    workflowRuns: overview.workflowRuns,
    tasksCompleted: overview.tasksCompleted,
    recruitAiToolActions: recruitKpi ? recruitKpi.toolActions : null,
  };

  // ---- final summary --------------------------------------------------
  step('SUMMARY', 'Demo company seeded');
  log(JSON.stringify(
    {
      base: BASE,
      suffix: SUFFIX,
      logins: {
        owner: { email: ownerEmail, password: PASSWORD, role: 'OWNER' },
        admin: { email: adminEmail, password: PASSWORD, role: 'ADMIN' },
        manager: { email: managerEmail, password: PASSWORD, role: 'MEMBER' },
      },
      ...summary,
    },
    null,
    2,
  ));
  log('\nDONE.');

  // expose for the caller
  return { ownerEmail, adminEmail, managerEmail, companyId, employeeId, summary };
}

main().catch((err) => {
  console.error('\nSEED FAILED:', err.message);
  process.exit(1);
});
