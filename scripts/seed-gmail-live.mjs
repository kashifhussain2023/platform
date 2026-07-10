#!/usr/bin/env node
/**
 * seed-gmail-live.mjs — drives the REAL V-AEP HTTP API to provision ONE company
 * ("Kashif Recruiting") owned by real Gmail addresses, ready for a LIVE Gmail
 * test. The Gmail connector is INSTALLED but left NOT_CONNECTED — the real
 * Google OAuth flow is completed later by the user (the API needs OAUTH_GOOGLE_*
 * env for that; until then /oauth/authorize returns a clear 400).
 *
 * Node 22 (global fetch/FormData/Blob), ESM. NOT re-runnable as-is: the login
 * emails are fixed real Gmail addresses (a second run 409s on register).
 *
 * Usage: node scripts/seed-gmail-live.mjs [baseUrl]
 * The API must already be listening (see platform/CLAUDE.md for the boot env).
 */

const BASE = process.argv[2] || process.env.BASE || 'http://localhost:4000';
const PASSWORD = 'Kashif@V-AEP2026';
const OWNER_EMAIL = 'kashifhussain146@gmail.com';
const ADMIN_EMAIL = 'kashifhussain.jaipur@gmail.com';

// ---------------------------------------------------------------------------
// tiny HTTP helpers
// ---------------------------------------------------------------------------
let TOKEN = null;

async function req(method, path, body, { token, raw } = {}) {
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
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (raw) return { status: res.status, ok: res.ok, json };
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status} ${res.statusText}: ${
        typeof json === 'string' ? json : JSON.stringify(json)
      }`,
    );
  }
  return json;
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

// ---------------------------------------------------------------------------
async function main() {
  log(`V-AEP live-Gmail seed  base=${BASE}`);

  // ---- 1. Register company + owner (real Gmail) -----------------------
  step(1, 'Register "Kashif Recruiting" + owner (real Gmail)');
  const reg = await post('/auth/register', {
    companyName: 'Kashif Recruiting',
    name: 'Kashif Hussain',
    email: OWNER_EMAIL,
    password: PASSWORD,
    industry: 'Recruiting',
    size: '11-50',
    country: 'India',
    timezone: 'Asia/Kolkata',
    description: 'A recruiting firm piloting V-AEP managed AI Employees with a live Gmail connector.',
  });
  TOKEN = reg.tokens.accessToken;
  const companyId = reg.company.id;
  log(`  company=${reg.company.name} id=${companyId} slug=${reg.company.slug}`);
  log(`  owner=${reg.user.email} role=${reg.user.role} allowedEmailDomains stay empty (gmail.com allowed)`);
  summary.company = { name: reg.company.name, id: companyId, slug: reg.company.slug };
  summary.owner = { email: OWNER_EMAIL, role: reg.user.role };

  // ---- 2. Team: create ADMIN (real Gmail), verify login ---------------
  step(2, 'Create ADMIN user (real Gmail) + verify login');
  const admin = await post('/users', {
    email: ADMIN_EMAIL,
    name: 'Kashif Hussain (Jaipur)',
    role: 'ADMIN',
    password: PASSWORD,
  });
  log(`  created ADMIN=${admin.email} id=${admin.id} role=${admin.role}`);
  const adminLogin = await post('/auth/login', { email: ADMIN_EMAIL, password: PASSWORD }, { token: null });
  log(`  login ADMIN ok=${!!adminLogin.tokens.accessToken}`);
  if (!adminLogin.tokens.accessToken) throw new Error('ADMIN login failed');
  summary.admin = { email: ADMIN_EMAIL, role: 'ADMIN' };

  // ---- 3. Company profile ---------------------------------------------
  step(3, 'Company profile (PATCH /companies/current)');
  const company = await patch('/companies/current', {
    industry: 'Recruiting',
    size: '11-50',
    country: 'India',
    timezone: 'Asia/Kolkata',
    description: 'Kashif Recruiting places senior engineers. Piloting V-AEP AI Employees with live Gmail.',
  });
  log(`  industry=${company.industry} size=${company.size} country=${company.country} tz=${company.timezone}`);

  // ---- 4. Marketplace: install RecruitAI ------------------------------
  step(4, 'Marketplace: install RecruitAI (RECRUITER)');
  const recruit = await post('/marketplace/employees/recruit-ai/install', {});
  const employeeId = recruit.id;
  log(`  installed RecruitAI id=${employeeId} role=${recruit.role}`);
  summary.employeeId = employeeId;

  // ---- 5. Skills: install gmail (+calendar), config, assign -----------
  step(5, 'Skills: install gmail + calendar (NO fake-connect), config, assign');
  // gmail — leave NOT_CONNECTED (real OAuth done later by the user).
  const gmail = await post('/skills/install', { skillKey: 'gmail' });
  const gmailConnectorId = gmail.id;
  log(`  installed gmail id=${gmailConnectorId} connectionStatus=${gmail.connectionStatus}`);
  // gmail configSchema uses `companyEmail` (the from/sending address) — the
  // catalog has no `fromAddress` key, so companyEmail carries the send address.
  const gmailCfg = await patch(`/skills/installed/${gmailConnectorId}/config`, {
    config: {
      companyEmail: OWNER_EMAIL,
      dailyEmailLimit: 50,
      signature: 'Kashif Hussain\nKashif Recruiting\nvia RecruitAI (V-AEP)',
      canSend: true,
      canRead: true,
    },
  });
  log(`  gmail config set companyEmail=${gmailCfg.config?.companyEmail} dailyEmailLimit=${gmailCfg.config?.dailyEmailLimit} connectionStatus=${gmailCfg.connectionStatus}`);

  const calendar = await post('/skills/install', { skillKey: 'calendar' });
  const calendarConnectorId = calendar.id;
  await patch(`/skills/installed/${calendarConnectorId}/config`, {
    config: { defaultCalendar: 'primary', timezone: 'Asia/Kolkata' },
  });
  log(`  installed calendar id=${calendarConnectorId} connectionStatus=${calendar.connectionStatus}`);

  // Assign both to RecruitAI (assignment is independent of connection state).
  const asgGmail = await post(`/employees/${employeeId}/skills`, { installedSkillId: gmailConnectorId });
  const asgCal = await post(`/employees/${employeeId}/skills`, { installedSkillId: calendarConnectorId });
  log(`  assigned gmail=${asgGmail.id} calendar=${asgCal.id} to RecruitAI`);
  summary.gmailConnectorId = gmailConnectorId;
  summary.calendarConnectorId = calendarConnectorId;

  // ---- 6. Configure RecruitAI (approval-gated live sends) --------------
  step(6, 'Configure RecruitAI (approvalRules gate gmail:send_email)');
  const configured = await patch(`/employees/${employeeId}`, {
    department: 'People',
    managerName: 'Kashif',
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    timezone: 'Asia/Kolkata',
    language: 'en',
    knowledgeAccess: 'ALL',
    permissions: { sendEmail: true },
    approvalRules: { requireApprovalForTools: ['gmail:send_email'] },
    goals: ['Hire senior engineers'],
    kpiTargets: { tasksPerWeek: 30, successRatePct: 80 },
    persona:
      'You are RecruitAI, a senior technical recruiter for Kashif Recruiting. ' +
      'You ground answers in the company hiring policy and escalate offers to HR. ' +
      'All outbound Gmail sends require human approval.',
  });
  log(`  dept=${configured.department} manager=${configured.managerName} hours=${configured.workingHoursStart}-${configured.workingHoursEnd} tz=${configured.timezone}`);
  log(`  knowledgeAccess=${configured.knowledgeAccess} approvalRules=${JSON.stringify(configured.approvalRules)}`);
  summary.approvalRules = configured.approvalRules;

  // ---- 7. Knowledge: upload Hiring Policy, poll READY -----------------
  step(7, 'Knowledge: upload "Hiring Policy" doc, poll READY');
  const hiringPolicy = [
    'KASHIF RECRUITING — HIRING POLICY',
    '',
    'Minimum experience: candidates for senior engineering roles must have at least',
    '3 years of professional software engineering experience.',
    '',
    'Salary bands (illustrative): Senior Engineer INR 25-40 LPA; Staff Engineer INR 40-60 LPA.',
    '',
    'Escalation: any offer, or any negotiation beyond the published band, must be',
    'escalated to HR before any commitment is made to the candidate.',
    '',
    'Equal opportunity: we hire without regard to protected characteristics.',
  ].join('\n');
  const fd = new FormData();
  fd.append('file', new Blob([hiringPolicy], { type: 'text/plain' }), 'Hiring-Policy.txt');
  const doc = await post('/knowledge/documents', fd);
  log(`  uploaded Hiring-Policy.txt id=${doc.id} status=${doc.status}`);
  const readyDoc = await poll(
    async () => {
      const d = await get(`/knowledge/documents/${doc.id}`);
      if (d.status === 'READY') return d;
      if (d.status === 'FAILED') throw new Error(`ingestion FAILED: ${d.error}`);
      return false;
    },
    { tries: 60, delayMs: 500, label: 'Hiring Policy READY' },
  );
  log(`  Hiring Policy READY chunks=${readyDoc.chunkCount}`);
  summary.knowledge = { docId: doc.id, chunks: readyDoc.chunkCount };

  // ---- 8. Workflow: build + activate (EVENT NEW_EMAIL) ----------------
  step(8, 'Workflow: "New Candidate Email -> Screen -> Notify" (EVENT NEW_EMAIL), activate');
  const created = await post('/workflows', {
    name: 'New Candidate Email -> Screen -> Notify',
    description: 'On a new candidate email, retrieve hiring policy, AI-score the candidate, gate on HR approval, notify.',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'New candidate email', config: {} },
        { id: 'r1', type: 'RETRIEVE', name: 'Policy lookup', config: { query: 'senior engineer hiring policy', k: 5, outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'Score candidate', config: { prompt: 'Score the candidate in this email: {{trigger.subject}} {{trigger.body}}. Use this policy context: {{policy}}', outputKey: 'score' } },
        { id: 'ap1', type: 'APPROVAL', name: 'HR approves screen', config: { message: 'HR approves screening this candidate?' } },
        { id: 'n1', type: 'NOTIFY', name: 'Notify recruiter', config: { message: 'Candidate screened and approved for next step.' } },
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
    triggerConfig: { eventType: 'NEW_EMAIL' },
  });
  const activated = await post(`/workflows/${created.id}/activate`, {});
  log(`  workflow id=${created.id} status=${activated.status} trigger=${activated.triggerType} eventType=${activated.triggerConfig?.eventType}`);
  summary.workflow = { id: created.id, status: activated.status, triggerType: activated.triggerType };

  // ---- 9. Gmail OAuth authorize URL (expected 400 until env set) ------
  step(9, 'GET gmail /oauth/authorize (owner) — capture URL or "OAuth not configured"');
  const authz = await get(`/skills/installed/${gmailConnectorId}/oauth/authorize`, { raw: true });
  if (authz.ok && authz.json && typeof authz.json.url === 'string') {
    log(`  authorize URL returned: ${authz.json.url}`);
    summary.oauthAuthorize = { status: authz.status, url: authz.json.url };
  } else {
    const msg = typeof authz.json === 'object' && authz.json ? authz.json.message : authz.json;
    log(`  authorize errored status=${authz.status} message=${JSON.stringify(msg)}`);
    summary.oauthAuthorize = { status: authz.status, message: msg };
  }

  // ---- 10. Verify gmail connector is still NOT_CONNECTED --------------
  step(10, 'Verify gmail connector connectionStatus');
  const installedList = await get('/skills/installed');
  const gmailRow = installedList.find((s) => s.id === gmailConnectorId);
  log(`  gmail connectionStatus=${gmailRow?.connectionStatus} (must be NOT_CONNECTED)`);
  summary.gmailConnectionStatus = gmailRow?.connectionStatus;

  // ---- SUMMARY --------------------------------------------------------
  step('SUMMARY', 'Live-Gmail company seeded');
  log(JSON.stringify(
    {
      base: BASE,
      logins: {
        owner: { email: OWNER_EMAIL, password: PASSWORD, role: 'OWNER' },
        admin: { email: ADMIN_EMAIL, password: PASSWORD, role: 'ADMIN' },
      },
      ...summary,
    },
    null,
    2,
  ));
  log('\nDONE.');
  return { companyId, employeeId, gmailConnectorId, summary };
}

main().catch((err) => {
  console.error('\nSEED FAILED:', err.message);
  process.exit(1);
});
