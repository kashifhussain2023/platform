#!/usr/bin/env node
/**
 * seed-flow-kashif.mjs — additive, re-runnable seeder that layers a rich,
 * production-realistic recruitment-operation dataset onto the EXISTING live
 * company "Kashif Recruiting" (companyId cmrf5iewn0003cs6wap8fwpkd) via the
 * ALREADY-RUNNING API at http://localhost:4000.
 *
 * SAFETY: Gmail is NOT_CONNECTED (mock). We NEVER approve a gmail:send_email
 * approval — those are left PENDING so no real email is ever sent.
 *
 * Usage:  node scripts/seed-flow-kashif.mjs [suffix] [baseUrl]
 * Node 22 (global fetch/FormData/Blob), ESM. Idempotent where practical
 * (departments/teams/skills are only created if missing); brand-new emails use
 * a unique suffix so re-runs don't collide.
 */

const BASE = process.argv[3] || process.env.BASE || 'http://localhost:4000';
const SUFFIX = process.argv[2] || String(Date.now());
const OWNER_EMAIL = 'kashifhussain146@gmail.com';
const OWNER_PASSWORD = 'Kashif@V-AEP2026';
const MEMBER_PASSWORD = 'Kashif@V-AEP2026';
const EXPECTED_COMPANY_ID = 'cmrf5iewn0003cs6wap8fwpkd';

// --- tiny HTTP helpers -----------------------------------------------------
let TOKEN = null;

async function relogin() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  const j = await res.json();
  TOKEN = j.tokens.accessToken;
  return TOKEN;
}

async function req(method, path, body, { token, raw, _retried } = {}) {
  const headers = {};
  const useToken = token !== undefined ? token : TOKEN;
  if (useToken) headers.Authorization = `Bearer ${useToken}`;
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  // Transparent single re-login on owner-token expiry (JWT ~15min) for long runs.
  if (res.status === 401 && token === undefined && !_retried && path !== '/auth/login') {
    await relogin();
    return req(method, path, body, { raw, _retried: true });
  }
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
async function poll(fn, { tries = 60, delayMs = 500, label = 'condition' } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const result = await fn();
    if (result !== undefined && result !== null && result !== false) return result;
    await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const log = (...a) => console.log(...a);
const step = (n, t) => log(`\n=== ${n}. ${t} ===`);

const summary = {};

async function main() {
  log(`Kashif Recruiting flow seed  base=${BASE}  suffix=${SUFFIX}`);

  // ---- 0. Login + assert companyId --------------------------------------
  step(0, 'Login as owner + assert companyId');
  const login = await post('/auth/login', { email: OWNER_EMAIL, password: OWNER_PASSWORD }, { token: null });
  TOKEN = login.tokens.accessToken;
  const companyId = login.company.id;
  log(`  company=${login.company.name} id=${companyId} owner=${login.user.email}`);
  if (companyId !== EXPECTED_COMPANY_ID) {
    throw new Error(`ABORT: companyId ${companyId} !== expected ${EXPECTED_COMPANY_ID}`);
  }
  log(`  companyId matches expected ${EXPECTED_COMPANY_ID}`);

  const employees = await get('/employees');
  const recruit = employees.find((e) => e.name === 'RecruitAI') || employees[0];
  const employeeId = recruit.id;
  log(`  employee RecruitAI id=${employeeId}`);
  summary.companyId = companyId;
  summary.employeeId = employeeId;

  // ---- 1. Billing -> BUSINESS -------------------------------------------
  step(1, 'Billing: upgrade to BUSINESS');
  const sub0 = await get('/billing/subscription');
  const subBiz = await post('/billing/subscription', { plan: 'BUSINESS' });
  log(`  plan ${sub0.plan} -> ${subBiz.plan} status=${subBiz.status}`);
  summary.billing = { from: sub0.plan, to: subBiz.plan };

  // ---- 2. Team: 2 MEMBER users ------------------------------------------
  step(2, 'Team: create 2 MEMBER users + verify one login');
  const usersNow = await get('/users');
  // Idempotent: reuse existing members (matched by local-part prefix) so re-runs
  // converge on exactly two MEMBER users instead of creating duplicates.
  async function ensureMember(prefix, name) {
    const existing = usersNow.find((u) => u.email.startsWith(`${prefix}+`) && u.role === 'MEMBER');
    if (existing) { log(`  MEMBER ${existing.email} already exists (${existing.id})`); return existing.email; }
    const email = `${prefix}+${SUFFIX}@kashifrecruiting.com`;
    const u = await post('/users', { email, name, role: 'MEMBER', password: MEMBER_PASSWORD });
    log(`  created MEMBER ${u.email} (${u.id})`);
    return email;
  }
  const priyaEmail = await ensureMember('priya.sharma', 'Priya Sharma');
  const raviEmail = await ensureMember('ravi.kumar', 'Ravi Kumar');
  const priyaLogin = await post('/auth/login', { email: priyaEmail, password: MEMBER_PASSWORD }, { token: null });
  log(`  login Priya ok=${!!priyaLogin.tokens.accessToken} role=${priyaLogin.user.role}`);
  const allUsers = await get('/users');
  log(`  total users in company = ${allUsers.length}`);
  summary.team = { members: [priyaEmail, raviEmail], totalUsers: allUsers.length, memberLoginOk: !!priyaLogin.tokens.accessToken };

  // ---- 3. Org: Departments + Team (idempotent) --------------------------
  step(3, 'Org: ensure Departments People + Engineering, Team Backend Hiring');
  const existingDepts = await get('/departments');
  async function ensureDept(name, description) {
    const found = existingDepts.find((d) => d.name === name);
    if (found) { log(`  dept ${name} exists (${found.id})`); return found; }
    const d = await post('/departments', { name, description });
    log(`  created dept ${name} (${d.id})`);
    existingDepts.push(d);
    return d;
  }
  const deptPeople = await ensureDept('People', 'Recruiting & HR');
  const deptEng = await ensureDept('Engineering', 'Product engineering');
  const existingTeams = await get('/teams');
  let teamBackend = existingTeams.find((t) => t.name === 'Backend Hiring');
  if (teamBackend) {
    log(`  team Backend Hiring exists (${teamBackend.id})`);
  } else {
    teamBackend = await post('/teams', { name: 'Backend Hiring', departmentId: deptEng.id });
    log(`  created team Backend Hiring (${teamBackend.id})`);
  }
  summary.org = { departments: ['People', 'Engineering'], team: 'Backend Hiring' };

  // ---- 4. Knowledge: upload 3 more docs, poll READY ---------------------
  step(4, 'Knowledge: upload 3 docs (JD, Salary Bands 2026, Interview Scorecard)');
  const jd = [
    'KASHIF RECRUITING — SENIOR BACKEND ENGINEER JOB DESCRIPTION',
    '',
    'Role: Senior Backend Engineer (full-time, remote-friendly, India/EU timezones).',
    'Minimum experience: at least 3 years of professional backend engineering experience',
    'for any senior role (hard requirement).',
    '',
    'Must-have skills: strong in one of Node.js/Go/Java/Python; relational databases and',
    'SQL; REST/gRPC API design; message queues; containerisation (Docker); cloud (AWS/GCP).',
    'Nice-to-have: event-driven architecture, Kubernetes, observability tooling.',
    '',
    'Responsibilities: design and ship resilient services, own data models, mentor mid-level',
    'engineers, participate in on-call, uphold code review and testing standards.',
  ].join('\n');
  const bands = [
    'KASHIF RECRUITING — SALARY BANDS 2026 (illustrative, INR per annum)',
    '',
    'Junior Engineer:   INR   8,00,000 - 14,00,000',
    'Mid Engineer:      INR  14,00,000 - 24,00,000',
    'Senior Engineer:   INR  24,00,000 - 40,00,000',
    'Staff Engineer:    INR  40,00,000 - 60,00,000',
    '',
    'Any offer beyond the published band for a level must be escalated to the HR Head',
    'before any commitment is made to the candidate.',
  ].join('\n');
  const scorecard = [
    'KASHIF RECRUITING — INTERVIEW SCORECARD & RUBRIC',
    '',
    'Interview process (4 stages):',
    'Stage 1 Recruiter Screen (30 min): experience, role fit, notice period.',
    'Stage 2 Technical Interview: live coding on backend fundamentals.',
    'Stage 3 System Design: architecture & scalability (senior/staff only).',
    'Stage 4 HR Round: compensation expectations and culture fit.',
    '',
    'Rubric — score each competency 1 (poor) to 5 (excellent):',
    'Coding & problem solving; System design; Communication; Ownership; Culture add.',
    'Recommendation: STRONG_HIRE / HIRE / NO_HIRE / STRONG_NO_HIRE.',
    'Only candidates clearing all four stages proceed to an offer within band.',
  ].join('\n');

  async function upload(name, content) {
    const fd = new FormData();
    fd.append('file', new Blob([content], { type: 'text/plain' }), name);
    const doc = await post('/knowledge/documents', fd);
    log(`  uploaded ${name} id=${doc.id} status=${doc.status}`);
    return doc;
  }
  async function waitReady(id, label) {
    const doc = await poll(async () => {
      const d = await get(`/knowledge/documents/${id}`);
      if (d.status === 'READY') return d;
      if (d.status === 'FAILED') throw new Error(`${label} ingestion FAILED: ${d.error}`);
      return false;
    }, { tries: 90, delayMs: 500, label: `${label} READY` });
    log(`  ${label} READY chunks=${doc.chunkCount}`);
    return doc;
  }
  // Idempotent: skip re-upload if a doc with the same logical base already exists
  // (so re-runs converge on the same 4 docs rather than piling up duplicates).
  const existingDocs = await get('/knowledge/documents');
  async function ensureDoc(base, label, content) {
    const found = existingDocs.find((d) => d.filename.startsWith(base));
    if (found) {
      log(`  ${label} already present (${found.filename}, ${found.status})`);
      if (found.status !== 'READY') await waitReady(found.id, label);
      return;
    }
    const doc = await upload(`${base}${SUFFIX}.txt`, content);
    await waitReady(doc.id, label);
  }
  await ensureDoc('Senior-Backend-Engineer-JD-', 'JD', jd);
  await ensureDoc('Salary-Bands-2026-', 'Salary Bands', bands);
  await ensureDoc('Interview-Scorecard-Rubric-', 'Scorecard', scorecard);
  const allDocs = await get('/knowledge/documents');
  const readyCount = allDocs.filter((d) => d.status === 'READY').length;
  log(`  total knowledge docs=${allDocs.length} READY=${readyCount}`);
  summary.knowledge = { total: allDocs.length, ready: readyCount };

  async function convTurn(title, content) {
    const conv = await post(`/employees/${employeeId}/conversations`, { title });
    const run = await post(`/conversations/${conv.id}/messages`, { content });
    return { conv, run };
  }

  // ---- 5. Grounded Q&A (temporarily unassign tools for CLEAN grounding) --
  // The mock LLM always fires a tool call when ANY tool is assigned, which would
  // turn a pure Q&A into an action (and could create stray approvals). So we
  // unassign RecruitAI's skills for the grounded turns, then restore + extend.
  step(5, 'Conversations: 3 grounded Q&A (skills temporarily unassigned)');
  const preAssigned = await get(`/employees/${employeeId}/skills`); // gmail + calendar
  log(`  temporarily unassigning ${preAssigned.length} skill(s) for clean grounding`);
  for (const es of preAssigned) {
    await req('DELETE', `/employees/${employeeId}/skills/${es.installedSkillId}`, undefined, { raw: true });
  }

  const groundedQs = [
    ['How to hire a Senior Backend Developer', 'How do we hire a Senior Backend Developer? Use our policy.'],
    ['Salary band for a senior engineer', 'What are our salary bands for a senior engineer?'],
    ['Our interview process', "What's our interview process?"],
  ];
  const grounded = [];
  for (const [title, content] of groundedQs) {
    const { conv, run } = await convTurn(title, content);
    const nSources = run.sources?.length ?? 0;
    log(`  [grounded] "${title}" sources=${nSources} grounded=${run.validation?.grounded} toolCalls=${(run.toolCalls || []).length} msg=${run.message.id}`);
    grounded.push({ conversationId: conv.id, messageId: run.message.id, sources: nSources, grounded: run.validation?.grounded });
    if (nSources === 0) log(`  WARN: grounded Q "${title}" returned 0 sources`);
  }

  // ---- 6. Skills: restore gmail/calendar + install/assign slack + http ---
  step(6, 'Skills: restore gmail/calendar, ensure slack + http installed/configured/connected/assigned');
  const installed = await get('/skills/installed');
  const gmailInst = installed.find((s) => s.skillKey === 'gmail');
  const calInst = installed.find((s) => s.skillKey === 'calendar');
  for (const inst of [gmailInst, calInst]) {
    if (inst) {
      await post(`/employees/${employeeId}/skills`, { installedSkillId: inst.id });
      log(`  restored assignment: ${inst.skillKey}`);
    }
  }
  const skillConfigs = {
    slack: { config: { defaultChannel: '#hiring' } },
    http: { config: { baseUrl: 'https://ats.kashifrecruiting.com', authHeader: 'Bearer demo-ats-token' } },
  };
  async function ensureSkill(skillKey) {
    let inst = installed.find((s) => s.skillKey === skillKey);
    if (!inst) {
      inst = await post('/skills/install', { skillKey });
      installed.push(inst);
      log(`  installed ${skillKey} (${inst.id})`);
    } else {
      log(`  ${skillKey} already installed (${inst.id})`);
    }
    await patch(`/skills/installed/${inst.id}/config`, skillConfigs[skillKey]);
    // NOTE: deliberately keep slack NOT_CONNECTED. The running API uses a live
    // (auto/real) skill executor, so a CONNECTED slack with placeholder creds
    // would attempt a REAL Slack API call and ERROR. Left NOT_CONNECTED, the
    // executor falls back to the offline MOCK → deterministic SUCCESS. Disconnect
    // if a prior run connected it.
    if (skillKey === 'slack' && inst.connectionStatus === 'CONNECTED') {
      try { await post(`/skills/installed/${inst.id}/disconnect`, {}); log('  slack disconnected (force mock executor)'); }
      catch (e) { log(`  slack disconnect skipped: ${e.message.slice(0, 80)}`); }
    }
    try {
      await post(`/employees/${employeeId}/skills`, { installedSkillId: inst.id });
      log(`  ${skillKey} assigned to RecruitAI`);
    } catch (e) {
      log(`  ${skillKey} assign skipped: ${e.message.slice(0, 80)}`);
    }
    return inst;
  }
  await ensureSkill('slack');
  await ensureSkill('http');
  const empSkills = await get(`/employees/${employeeId}/skills`);
  const installedNow = await get('/skills/installed');
  log(`  installed skills=${installedNow.length} assigned to RecruitAI=${empSkills.length}`);
  summary.skills = { installed: installedNow.map((s) => s.skillKey), assignedCount: empSkills.length };

  // Additively harden the email approval gate. The mock LLM maps the send_email
  // tool to skillKey 'email' (catalog-order collision: 'email' precedes 'gmail'),
  // so we gate 'email:send_email' too. Combined with the existing
  // 'gmail:send_email' rule this guarantees ANY email-send intent pauses for
  // approval (never sends), satisfying the "no emails sent" safety rule.
  const gatedTools = ['gmail:send_email', 'email:send_email', 'email'];
  await patch(`/employees/${employeeId}`, { approvalRules: { requireApprovalForTools: gatedTools } });
  log(`  approvalRules.requireApprovalForTools = ${JSON.stringify(gatedTools)}`);

  // ---- 6b. Action conversations -----------------------------------------
  step('6b', 'Conversations: 2 slack action->completed, 1 gmail action->pending');
  // slack:send_message is NOT approval-gated -> executes mock -> SkillExecution.
  // Wording contains "slack"+"send"+"message" so the mock picks slack.send_message.
  const slackActions = [
    ['Announce Senior Backend role on Slack', 'Send a Slack message to #hiring announcing we opened a Senior Backend Engineer role.'],
    ['Announce interviews scheduled on Slack', 'Send a Slack message to #hiring that first-round interviews for the Senior Backend role are scheduled this week.'],
  ];
  const slackRuns = [];
  for (const [title, content] of slackActions) {
    const { conv, run } = await convTurn(title, content);
    const calls = run.toolCalls || [];
    const executed = calls.filter((c) => c.ok && !c.pendingApproval);
    log(`  [slack] "${title}" toolCalls=${calls.length} executed=${executed.length} pending=${calls.filter((c) => c.pendingApproval).length} calls=${calls.map((c) => `${c.skillKey}:${c.tool}`).join(',')} msg=${run.message.id}`);
    slackRuns.push({ conversationId: conv.id, messageId: run.message.id, executed: executed.length, calls: calls.map((c) => `${c.skillKey}:${c.tool}${c.pendingApproval ? '(pending)' : ''}`) });
  }

  // gmail:send_email IS approval-gated -> creates PENDING ApprovalRequest (no send).
  // Wording contains "gmail"+"email"+"send" so the mock picks gmail.send_email.
  const { conv: convGmail, run: gmailRun } = await convTurn(
    'Email interview invite to shortlisted candidate',
    'Send an email via Gmail to the shortlisted candidate with an interview invite for the Senior Backend role.',
  );
  const gCalls = gmailRun.toolCalls || [];
  const gmailPending = gCalls.find((c) => c.pendingApproval);
  log(`  [gmail] toolCalls=${gCalls.map((c) => `${c.skillKey}:${c.tool}${c.pendingApproval ? '(pending)' : ''}`).join(',')} approvalId=${gmailPending?.approvalId} msg=${gmailRun.message.id}`);
  if (!gmailPending) log('  WARN: expected a pendingApproval gmail:send_email tool call');
  summary.conversations = {
    grounded,
    slack: slackRuns,
    gmailPending: gmailPending ? { conversationId: convGmail.id, approvalId: gmailPending.approvalId, tool: `${gmailPending.skillKey}:${gmailPending.tool}` } : null,
  };

  // ---- 7. Workflow runs (history): fire NEW_EMAIL x5 --------------------
  step(7, 'Workflow: fire NEW_EMAIL x5 -> WAITING; approve 3, leave 2 pending');
  const workflows = await get('/workflows');
  const wf = workflows.find((w) => w.triggerConfig?.eventType === 'NEW_EMAIL' && w.status === 'ACTIVE') || workflows[0];
  log(`  target workflow "${wf.name}" id=${wf.id} trigger=${wf.triggerType}/${wf.triggerConfig?.eventType}`);

  const candidates = [
    { candidate: 'Ananya Rao', email: 'ananya.rao@example.com', subject: 'Application: Senior Backend Developer', body: '8 years Node.js and Go, led payments platform.' },
    { candidate: 'Vikram Singh', email: 'vikram.singh@example.com', subject: 'Senior Backend Engineer application', body: '6 years Java/Spring, distributed systems at scale.' },
    { candidate: 'Meera Iyer', email: 'meera.iyer@example.com', subject: 'Re: Senior Backend role', body: '5 years Python/Django, strong on API design and SQL.' },
    { candidate: 'Arjun Nair', email: 'arjun.nair@example.com', subject: 'Backend Engineer - senior', body: '4 years Go microservices, Kubernetes, GCP.' },
    { candidate: 'Sara Khan', email: 'sara.khan@example.com', subject: 'Application for Senior Backend Developer', body: '7 years Node.js, event-driven architecture, mentoring.' },
  ];
  const runIds = [];
  for (const c of candidates) {
    const fired = await post('/workflows/events', {
      eventType: 'NEW_EMAIL',
      payload: { role: 'Senior Backend Developer', candidate: c.candidate, email: c.email, subject: c.subject, body: c.body },
    });
    if (!fired.count || fired.count < 1) throw new Error(`NEW_EMAIL for ${c.candidate} matched no workflow`);
    const runId = fired.runIds[0];
    runIds.push(runId);
    log(`  fired for ${c.candidate}: matched=${fired.count} runId=${runId}`);
  }

  // wait each run to WAITING
  async function waitStatus(runId, statuses, label) {
    return poll(async () => {
      const r = await get(`/workflows/runs/${runId}`);
      if (statuses.includes(r.status)) return r;
      if (r.status === 'FAILED') throw new Error(`Run ${runId} FAILED: ${r.error}`);
      return false;
    }, { tries: 90, delayMs: 500, label });
  }
  for (const runId of runIds) {
    await waitStatus(runId, ['WAITING'], `run ${runId} WAITING`);
  }
  log(`  all ${runIds.length} runs reached WAITING`);

  // approve first 3, leave last 2 pending
  async function approvalForRun(runId) {
    return poll(async () => {
      const list = await get('/approvals?status=PENDING');
      return list.find((a) => a.kind === 'WORKFLOW' && a.workflowRunId === runId) || false;
    }, { tries: 40, delayMs: 500, label: `workflow approval for run ${runId}` });
  }
  const approvedRunIds = [];
  for (let i = 0; i < 3; i += 1) {
    const ap = await approvalForRun(runIds[i]);
    await post(`/approvals/${ap.id}/approve`, { note: 'HR approves screening this candidate' });
    await waitStatus(runIds[i], ['COMPLETED'], `run ${runIds[i]} COMPLETED`);
    approvedRunIds.push(runIds[i]);
    log(`  approved run ${runIds[i]} -> COMPLETED (approval ${ap.id})`);
  }
  const pendingRunIds = runIds.slice(3);
  log(`  left ${pendingRunIds.length} runs WAITING (pending): ${pendingRunIds.join(', ')}`);

  // ---- 8. Approvals mix: reject 1 extra ---------------------------------
  step(8, 'Approvals: fire a 6th NEW_EMAIL and REJECT its approval');
  const reject = await post('/workflows/events', {
    eventType: 'NEW_EMAIL',
    payload: { role: 'Senior Backend Developer', candidate: 'Rohit Verma', email: 'rohit.verma@example.com', subject: 'Junior dev application', body: 'Recent grad, 1 year experience.' },
  });
  const rejectRunId = reject.runIds[0];
  await waitStatus(rejectRunId, ['WAITING'], `run ${rejectRunId} WAITING`);
  const rejectAp = await approvalForRun(rejectRunId);
  const rejected = await post(`/approvals/${rejectAp.id}/reject`, { note: 'Does not meet 3+ years senior requirement' });
  log(`  rejected approval ${rejectAp.id} status=${rejected.status} (run ${rejectRunId})`);

  const apAll = await get('/approvals');
  const byStatus = apAll.reduce((m, a) => { m[a.status] = (m[a.status] || 0) + 1; return m; }, {});
  log(`  approvals by status: ${JSON.stringify(byStatus)}`);
  summary.workflowRuns = { fired: runIds.length + 1, approvedCompleted: approvedRunIds.length, pendingWaiting: pendingRunIds.length, rejected: 1 };
  summary.approvals = byStatus;

  // ---- 9. Learning/feedback ---------------------------------------------
  step(9, 'Learning: 2 thumbs-UP + 1 thumbs-DOWN with correction (-> FACT memory)');
  await post(`/employees/${employeeId}/feedback`, { messageId: grounded[0].messageId, conversationId: grounded[0].conversationId, rating: 'UP', note: 'Accurate hiring guidance.' });
  await post(`/employees/${employeeId}/feedback`, { messageId: grounded[2].messageId, conversationId: grounded[2].conversationId, rating: 'UP', note: 'Correct interview process.' });
  await post(`/employees/${employeeId}/feedback`, {
    messageId: grounded[1].messageId, conversationId: grounded[1].conversationId, rating: 'DOWN',
    note: 'Missed the seniority experience bar.',
    correction: 'Always require 3+ years experience for senior roles.',
  });
  const learning = await get(`/employees/${employeeId}/learning`);
  log(`  learning: feedback=${JSON.stringify(learning.feedback || learning.feedbackCounts || {})} memories=${JSON.stringify(learning.memories)}`);
  const memories = await get(`/employees/${employeeId}/memories`);
  const factFeedback = memories.filter((m) => m.kind === 'FACT' && m.source === 'FEEDBACK');
  log(`  FACT/FEEDBACK memories=${factFeedback.length}: ${factFeedback.map((m) => JSON.stringify(m.content)).join(' | ')}`);
  summary.learning = { up: 2, down: 1, factFeedbackMemories: factFeedback.length };

  // ---- 10. Analytics ----------------------------------------------------
  step(10, 'Analytics: overview + employees');
  const overview = await get('/analytics/overview?range=all');
  log(`  overview: employees=${overview.employees} toolActions=${overview.toolActions} conversations=${overview.conversations} assistantMessages=${overview.assistantMessages} workflowRuns=${overview.workflowRuns} workflowCompleted=${overview.workflowCompleted} tasksCompleted=${overview.tasksCompleted} successRate=${overview.successRate}`);
  const empAnalytics = await get('/analytics/employees?range=all');
  const kpi = empAnalytics.find((e) => e.employeeId === employeeId);
  if (kpi) log(`  RecruitAI: toolActions=${kpi.toolActions} conversations=${kpi.conversations} assistantMessages=${kpi.assistantMessages} tasksCompleted=${kpi.tasksCompleted} pendingApprovals=${kpi.pendingApprovals}`);
  summary.analytics = {
    employees: overview.employees, toolActions: overview.toolActions, conversations: overview.conversations,
    assistantMessages: overview.assistantMessages, workflowRuns: overview.workflowRuns, workflowCompleted: overview.workflowCompleted,
    tasksCompleted: overview.tasksCompleted, successRate: overview.successRate,
  };

  // ---- summary ----------------------------------------------------------
  step('SUMMARY', 'Kashif Recruiting flow seeded');
  log(JSON.stringify({ base: BASE, suffix: SUFFIX, members: { priya: priyaEmail, ravi: raviEmail, password: MEMBER_PASSWORD }, ...summary }, null, 2));
  log('\nDONE.');
  return summary;
}

main().catch((err) => {
  console.error('\nSEED FAILED:', err.message);
  process.exit(1);
});
