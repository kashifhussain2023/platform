/**
 * All 11 production workflow definitions for the real Kashif Recruiting
 * tenant. Each entry: { name, description, triggerType, triggerConfig,
 * activateByDefault, definition, sampleTrigger, notes }.
 *
 * Node-graph constraints this respects (apps/api/.../workflow-engine.service.ts):
 * - CONDITION only does a single left/right comparison (eq/neq/gt/gte/lt/lte)
 *   and picks ONE outgoing edge by branch:'true'|'false' — every CONDITION
 *   node here has BOTH branches wired (an unmatched branch throws + fails
 *   the run).
 * - Any node can set `outputKey` to publish its result into context for later
 *   `{{templates}}` — not just RETRIEVE/AI_STEP; TOOL_ACTION and NOTIFY can too.
 * - AI_STEP prompts are written to return a single bare token (integer or
 *   true/false) whenever their output feeds a CONDITION — the engine can't
 *   parse JSON out of a template, so free-form JSON output (Workflow 2) is
 *   deliberately followed by a second, tiny extraction AI_STEP.
 *
 * Real vs mock right now:
 * - REAL: gmail.send_email, slack.send_message, http.request,
 *   calendar.create_event, gdrive.{upload_file,create_folder,move_file,
 *   list_files,read_file}.
 * - MOCK (by design): github.remove_collaborator — never wired to a real
 *   GitHub call (destructive/hard-to-reverse on a live org).
 * - "Email" in the user's flow-charts is implemented via gmail.send_email
 *   (the only skill with a real send path) rather than installing the
 *   separate generic `email` skill, which has no real executor.
 *
 * Gmail-triggered workflows (Workflow 1, and the Mega workflow) share the
 * SAME EVENT/NEW_EMAIL trigger as the existing "New Candidate Email -> Screen
 * -> Notify" (RecruitAI) workflow already live on this tenant. Activating
 * more than one of these at once means EVERY inbound candidate email fires
 * ALL of them — duplicate scoring, duplicate Slack/email sends. They default
 * to DRAFT; activate at most ONE Gmail-triggered recruiting workflow at a time.
 */

const SLACK_CHANNEL = process.env.SLACK_CHANNEL || '#all-ai-employees';
const RESUME_PARSER_URL = process.env.RESUME_PARSER_URL || 'https://httpbin.org/post';
const BACKGROUND_API_URL = process.env.BACKGROUND_API_URL || 'https://httpbin.org/post';

const gmailTrigger = { eventType: 'NEW_EMAIL', conditions: [{ op: 'eq', path: 'looksLikeApplication', value: 'true' }] };

export const WORKFLOWS = [
  // --- Workflow 1: Candidate Resume Screening (Production) ------------------
  {
    name: 'Candidate Resume Screening (Production)',
    description: 'Gmail candidate email -> save resume to Drive -> parse -> AI score vs hiring policy -> HR approval -> email + Slack + move resume folder.',
    triggerType: 'EVENT',
    triggerConfig: gmailTrigger,
    activateByDefault: false,
    notes: 'Gmail-triggered — see module doc. Deactivate the existing RecruitAI workflow before activating this one.',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'New candidate email', config: {} },
        { id: 'd1', type: 'TOOL_ACTION', name: 'Save resume to Drive', config: { tool: 'upload_file', skillKey: 'gdrive', args: { name: 'resume-{{trigger.from}}.txt', content: '{{trigger.cv}}' }, outputKey: 'resumeFile' } },
        { id: 'h1', type: 'TOOL_ACTION', name: 'Resume parser API', config: { tool: 'request', skillKey: 'http', args: { method: 'POST', url: RESUME_PARSER_URL, body: '{{trigger.cv}}' }, outputKey: 'parsed' } },
        { id: 'r1', type: 'RETRIEVE', name: 'Hiring policy', config: { k: 5, query: 'hiring policy', outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'Score candidate', config: { prompt: 'You are screening a job candidate against our hiring policy.\n\nSTEP 1 — Role match: check whether the candidate\'s actual role/discipline has a policy defined in the retrieved context (each policy defines its own eligible position(s), experience range, and salary band). If NONE of the retrieved policy content is for the candidate\'s actual discipline/role, the candidate does NOT qualify — score no higher than 40.\n\nSTEP 2 — Salary check: if the candidate has stated an expected/desired salary anywhere in the email or CV, compare it to the matched position\'s salary band. If their stated expectation is more than roughly 25% above the TOP of that band, this is a strong mismatch — score no higher than 50, regardless of technical fit.\n\nSTEP 3 — If (and only if) the role matches a defined position AND any stated salary expectation is reasonably compatible with its band, score 0-100 based on how well their experience/skills fit that position\'s requirements.\n\nRespond with ONLY a single integer between 0 and 100. No words, no punctuation, no % sign, no explanation — just the number.\n\nFrom: {{trigger.from}}\nSubject: {{trigger.subject}}\nEmail: {{trigger.body}}\nCV: {{trigger.cv}}\nPolicy: {{policy}}', outputKey: 'score' } },
        { id: 'c1', type: 'CONDITION', name: 'Score > 80?', config: { op: 'gt', left: '{{score}}', right: '80' } },
        { id: 'ap1', type: 'APPROVAL', name: 'HR approves', config: { message: 'Candidate {{trigger.from}} scored {{score}}/100. Proceed to shortlist?' } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email candidate (shortlisted)', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.from}}', subject: 'Your application — next steps', body: 'Thanks for applying. Your profile has been shortlisted (score {{score}}/100) and we will be in touch about next steps.' } } },
        { id: 's1', type: 'TOOL_ACTION', name: 'Slack notify', config: { tool: 'send_message', skillKey: 'slack', args: { channel: SLACK_CHANNEL, text: '✅ Candidate {{trigger.from}} shortlisted — score {{score}}/100.' } } },
        { id: 'g1', type: 'TOOL_ACTION', name: 'Move resume to Shortlisted', config: { tool: 'move_file', skillKey: 'gdrive', args: { name: 'resume-{{trigger.from}}.txt', toFolder: 'Shortlisted' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Candidate {{trigger.from}} shortlisted and notified.' } },
        { id: 'e2', type: 'TOOL_ACTION', name: 'Email rejection', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.from}}', subject: 'Update on your application', body: 'Thank you for your interest. We will not be proceeding with your application at this time.' } } },
        { id: 'g2', type: 'TOOL_ACTION', name: 'Move resume to Rejected', config: { tool: 'move_file', skillKey: 'gdrive', args: { name: 'resume-{{trigger.from}}.txt', toFolder: 'Rejected' } } },
        { id: 'n2', type: 'NOTIFY', config: { message: 'Candidate {{trigger.from}} rejected (score {{score}}/100).' } },
      ],
      edges: [
        { from: 't1', to: 'd1' }, { from: 'd1', to: 'h1' }, { from: 'h1', to: 'r1' }, { from: 'r1', to: 'a1' }, { from: 'a1', to: 'c1' },
        { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 'e2', branch: 'false' },
        { from: 'ap1', to: 'e1' }, { from: 'e1', to: 's1' }, { from: 's1', to: 'g1' }, { from: 'g1', to: 'n1' },
        { from: 'e2', to: 'g2' }, { from: 'g2', to: 'n2' },
      ],
    },
    sampleTrigger: {
      from: 'candidate@yopmail.com', subject: 'Application for Senior Backend Engineer',
      cv: 'Experienced backend engineer, 6 years Node.js/Postgres, led a team of 4.',
    },
  },

  // --- Workflow 2: Offer Approval --------------------------------------------
  {
    name: 'Offer Approval',
    description: 'Manual offer request -> AI eligibility (JSON) -> extracted boolean gate -> approval -> offer email -> Slack.',
    triggerType: 'MANUAL',
    triggerConfig: null,
    activateByDefault: true,
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'Offer request', config: {} },
        { id: 'r1', type: 'RETRIEVE', name: 'Hiring policy', config: { k: 3, query: 'hiring policy', outputKey: 'hiringPolicy' } },
        { id: 'r2', type: 'RETRIEVE', name: 'Salary band', config: { k: 3, query: 'salary band', outputKey: 'salaryBand' } },
        { id: 'r3', type: 'RETRIEVE', name: 'Offer policy', config: { k: 3, query: 'offer policy', outputKey: 'offerPolicy' } },
        {
          id: 'a1', type: 'AI_STEP', name: 'Check eligibility (JSON)',
          config: {
            prompt: 'Check whether this candidate qualifies for an offer.\nName: {{trigger.candidateName}}\nExperience: {{trigger.experience}}\nExpected salary: {{trigger.expectedSalary}}\nCurrent salary: {{trigger.currentSalary}}\nRole: {{trigger.role}}\nNotice period: {{trigger.noticePeriod}}\nTechnical screening and hiring-manager interview: {{trigger.screeningStatus}}\nHiring policy: {{hiringPolicy}}\nSalary band: {{salaryBand}}\nOffer policy: {{offerPolicy}}\n\nReturn ONLY JSON, no other text:\n{"eligible": true, "salaryBand": "25-40", "reason": ""}',
            outputKey: 'assessment',
          },
        },
        { id: 'a2', type: 'AI_STEP', name: 'Extract eligible flag', config: { prompt: 'From this JSON, output ONLY the word true or false (the "eligible" field), nothing else:\n{{assessment}}', outputKey: 'eligible' } },
        { id: 'c1', type: 'CONDITION', name: 'eligible == true', config: { op: 'eq', left: '{{eligible}}', right: 'true' } },
        { id: 'ap1', type: 'APPROVAL', name: 'Offer approval', config: { message: 'Offer for {{trigger.candidateName}} ({{trigger.role}}). Assessment: {{assessment}}. Approve?' } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email offer', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.email}}', subject: 'Offer — {{trigger.role}}', body: 'We are pleased to offer you the {{trigger.role}} position. Details: {{assessment}}' } } },
        { id: 's1', type: 'TOOL_ACTION', name: 'Slack notification', config: { tool: 'send_message', skillKey: 'slack', args: { channel: SLACK_CHANNEL, text: '✅ Offer approved for {{trigger.candidateName}} ({{trigger.role}}).' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Offer sent to {{trigger.candidateName}}.' } },
        { id: 'n2', type: 'NOTIFY', config: { message: '{{trigger.candidateName}} did not qualify for an offer: {{assessment}}' } },
      ],
      edges: [
        { from: 't1', to: 'r1' }, { from: 'r1', to: 'r2' }, { from: 'r2', to: 'r3' }, { from: 'r3', to: 'a1' }, { from: 'a1', to: 'a2' }, { from: 'a2', to: 'c1' },
        { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 'n2', branch: 'false' },
        { from: 'ap1', to: 'e1' }, { from: 'e1', to: 's1' }, { from: 's1', to: 'n1' },
      ],
    },
    sampleTrigger: {
      candidateName: 'Rohit Verma', email: 'rohit.verma@yopmail.com', experience: '3 years',
      expectedSalary: '14 LPA', currentSalary: '11 LPA', role: 'Software Engineer II', noticePeriod: '30 days',
      screeningStatus: 'Cleared technical screening and hiring-manager interview on 2026-07-10.',
    },
  },

  // --- Workflow 3: Employee Onboarding --------------------------------------
  {
    name: 'Employee Onboarding',
    description: 'Manual new-hire onboarding: welcome email, Drive folder, orientation meeting, Slack invite, credentials email.',
    triggerType: 'MANUAL',
    triggerConfig: null,
    activateByDefault: true,
    notes: 'Trigger payload must include orientationStart (ISO datetime) — the engine has no way to compute "tomorrow" from a template.',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'New employee', config: {} },
        { id: 'a1', type: 'AI_STEP', name: 'Generate welcome mail', config: { prompt: 'Write a short, warm welcome email body for a new employee.\nName: {{trigger.employeeName}}\nDepartment: {{trigger.department}}\nKeep it under 120 words.', outputKey: 'welcomeMail' } },
        { id: 'd1', type: 'TOOL_ACTION', name: 'Create Drive folder', config: { tool: 'create_folder', skillKey: 'gdrive', args: { name: '{{trigger.employeeName}}' } } },
        { id: 'c1', type: 'TOOL_ACTION', name: 'Create orientation meeting', config: { tool: 'create_event', skillKey: 'calendar', args: { title: 'Orientation — {{trigger.employeeName}}', start: '{{trigger.orientationStart}}' } } },
        { id: 's1', type: 'TOOL_ACTION', name: 'Invite to Slack', config: { tool: 'send_message', skillKey: 'slack', args: { channel: SLACK_CHANNEL, text: '👋 Please welcome {{trigger.employeeName}} joining {{trigger.department}}!' } } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Send credentials', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.email}}', subject: 'Welcome to the team', body: '{{welcomeMail}}' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Onboarding complete for {{trigger.employeeName}}.' } },
      ],
      edges: [
        { from: 't1', to: 'a1' }, { from: 'a1', to: 'd1' }, { from: 'd1', to: 'c1' }, { from: 'c1', to: 's1' }, { from: 's1', to: 'e1' }, { from: 'e1', to: 'n1' },
      ],
    },
    sampleTrigger: {
      employeeName: 'Priya Nair', email: 'priya.nair@yopmail.com', department: 'Engineering',
      orientationStart: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    },
  },

  // --- Workflow 5: Performance Review ----------------------------------------
  {
    name: 'Performance Review',
    description: 'Monthly (scheduled): KPI + performance policy retrieval -> AI-generated review -> manager approval -> email employee + Slack manager.',
    triggerType: 'SCHEDULE',
    triggerConfig: { cron: '0 9 1 * *' },
    activateByDefault: true,
    notes: 'SCHEDULE fires ONE run per tick, not one per employee — the engine has no per-employee batch/loop yet. Passes trigger.* fields if you fire it manually for a specific employee (see sampleTrigger); on the real monthly tick trigger.* will be empty.',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'Monthly review cycle', config: {} },
        { id: 'r1', type: 'RETRIEVE', name: 'Employee KPI', config: { k: 3, query: 'employee KPI performance targets', outputKey: 'kpi' } },
        { id: 'r2', type: 'RETRIEVE', name: 'Performance policy', config: { k: 3, query: 'performance review policy', outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'Generate review', config: { prompt: 'Write a brief performance review summary for this employee based on policy and KPI context.\nEmployee: {{trigger.employeeName}}\nKPI notes: {{trigger.kpiNotes}}\nKPI context: {{kpi}}\nPolicy: {{policy}}\nKeep it under 150 words.', outputKey: 'review' } },
        { id: 'ap1', type: 'APPROVAL', name: 'Manager approves review', config: { message: 'Review ready for {{trigger.employeeName}}: {{review}}. Approve to send?' } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email employee', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.email}}', subject: 'Your performance review', body: '{{review}}' } } },
        { id: 's1', type: 'TOOL_ACTION', name: 'Slack manager', config: { tool: 'send_message', skillKey: 'slack', args: { channel: SLACK_CHANNEL, text: 'Performance review sent to {{trigger.employeeName}}.' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Review cycle complete for {{trigger.employeeName}}.' } },
      ],
      edges: [
        { from: 't1', to: 'r1' }, { from: 'r1', to: 'r2' }, { from: 'r2', to: 'a1' }, { from: 'a1', to: 'ap1' }, { from: 'ap1', to: 'e1' }, { from: 'e1', to: 's1' }, { from: 's1', to: 'n1' },
      ],
    },
    sampleTrigger: {
      employeeName: 'Arjun Mehta', email: 'arjun.mehta@yopmail.com',
      kpiNotes: 'Completed 18/20 sprint tasks this quarter, 92% on-time delivery, 2 approvals pending.',
    },
  },

  // --- Workflow 6: Exit Process ----------------------------------------------
  {
    name: 'Exit Process',
    description: 'Manual exit request -> approval -> Slack + email -> archive Drive folder -> (simulated) GitHub access removal.',
    triggerType: 'MANUAL',
    triggerConfig: null,
    activateByDefault: true,
    notes: 'GitHub access removal is intentionally MOCK ONLY — no real executor case exists for github.remove_collaborator (destructive on a live org).',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'Exit request', config: {} },
        { id: 'ap1', type: 'APPROVAL', name: 'HR approves exit', config: { message: 'Confirm offboarding for {{trigger.employeeName}}, last day {{trigger.lastDay}}?' } },
        { id: 's1', type: 'TOOL_ACTION', name: 'Slack notify', config: { tool: 'send_message', skillKey: 'slack', args: { channel: SLACK_CHANNEL, text: '{{trigger.employeeName}} is offboarding, last day {{trigger.lastDay}}.' } } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email confirmation', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.email}}', subject: 'Offboarding confirmation', body: 'This confirms your last working day is {{trigger.lastDay}}. HR will be in touch regarding final settlement.' } } },
        { id: 'd1', type: 'TOOL_ACTION', name: 'Archive Drive folder', config: { tool: 'create_folder', skillKey: 'gdrive', args: { name: '{{trigger.employeeName}}', parent: 'Archive' } } },
        { id: 'g1', type: 'TOOL_ACTION', name: 'Disable GitHub access (simulated)', config: { tool: 'remove_collaborator', skillKey: 'github', args: { repo: '{{trigger.repo}}', username: '{{trigger.githubUsername}}' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Offboarding complete for {{trigger.employeeName}}.' } },
      ],
      edges: [
        { from: 't1', to: 'ap1' }, { from: 'ap1', to: 's1' }, { from: 's1', to: 'e1' }, { from: 'e1', to: 'd1' }, { from: 'd1', to: 'g1' }, { from: 'g1', to: 'n1' },
      ],
    },
    sampleTrigger: {
      employeeName: 'Sanjay Kulkarni', email: 'sanjay.kulkarni@yopmail.com', lastDay: '2026-08-15',
      repo: 'kashif-recruiting/backend', githubUsername: 'sanjay-k',
    },
  },

  // --- Workflow 7: Payroll Verification --------------------------------------
  {
    name: 'Payroll Verification',
    description: 'Monthly (scheduled): payroll policy retrieval -> AI validation -> gate -> approval -> email finance.',
    triggerType: 'SCHEDULE',
    triggerConfig: { cron: '0 9 28 * *' },
    activateByDefault: true,
    notes: 'Same per-tick (not per-employee) limitation as Performance Review — see its note.',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'Monthly payroll cycle', config: {} },
        { id: 'r1', type: 'RETRIEVE', name: 'Payroll policy', config: { k: 3, query: 'payroll policy', outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'Validate', config: { prompt: 'Validate this payroll run against policy. Reply ONLY true or false.\nHeadcount: {{trigger.headcount}}\nVariance vs last month: {{trigger.variancePct}}%\nPolicy: {{policy}}', outputKey: 'valid' } },
        { id: 'c1', type: 'CONDITION', name: 'Valid?', config: { op: 'eq', left: '{{valid}}', right: 'true' } },
        { id: 'ap1', type: 'APPROVAL', name: 'Finance approval', config: { message: 'Payroll run validated (headcount {{trigger.headcount}}, variance {{trigger.variancePct}}%). Approve disbursal?' } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email finance (approved)', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.financeEmail}}', subject: 'Payroll run approved', body: 'This month\'s payroll run passed validation and was approved for disbursal.' } } },
        { id: 'e2', type: 'TOOL_ACTION', name: 'Email finance (flagged)', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.financeEmail}}', subject: 'Payroll run FLAGGED', body: 'This month\'s payroll run failed validation (variance {{trigger.variancePct}}%) and needs manual review before disbursal.' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Payroll run approved and disbursed.' } },
        { id: 'n2', type: 'NOTIFY', config: { message: 'Payroll run flagged for manual review.' } },
      ],
      edges: [
        { from: 't1', to: 'r1' }, { from: 'r1', to: 'a1' }, { from: 'a1', to: 'c1' },
        { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 'e2', branch: 'false' },
        { from: 'ap1', to: 'e1' }, { from: 'e1', to: 'n1' }, { from: 'e2', to: 'n2' },
      ],
    },
    sampleTrigger: { headcount: '42', variancePct: '3', financeEmail: 'finance@kashif-it.com' },
  },

  // --- Workflow 8: Candidate Background Check --------------------------------
  {
    name: 'Candidate Background Check',
    description: 'New-hire background check via HTTP API + hiring policy -> AI risk analysis -> gate -> HR approval on flagged cases.',
    triggerType: 'MANUAL',
    triggerConfig: null,
    activateByDefault: true,
    notes: 'Trigger type is MANUAL — no real "new hire" event source exists yet; invoke this explicitly when a candidate is hired.',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'New hire', config: {} },
        { id: 'h1', type: 'TOOL_ACTION', name: 'Background check API', config: { tool: 'request', skillKey: 'http', args: { method: 'POST', url: BACKGROUND_API_URL, body: '{"name":"{{trigger.candidateName}}","email":"{{trigger.email}}"}' }, outputKey: 'bgCheck' } },
        { id: 'r1', type: 'RETRIEVE', name: 'Hiring policy', config: { k: 3, query: 'hiring policy background check', outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'Risk analysis', config: { prompt: 'Assess background-check risk for this candidate against policy. Reply ONLY "clear" or "flagged".\nCandidate: {{trigger.candidateName}}\nNotes: {{trigger.notes}}\nPolicy: {{policy}}', outputKey: 'risk' } },
        { id: 'c1', type: 'CONDITION', name: 'Flagged?', config: { op: 'eq', left: '{{risk}}', right: 'flagged' } },
        { id: 'ap1', type: 'APPROVAL', name: 'HR review (flagged)', config: { message: '{{trigger.candidateName}} flagged in background check. Proceed anyway?' } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email HR (flagged)', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.hrEmail}}', subject: 'Background check flagged', body: '{{trigger.candidateName}} was flagged: {{trigger.notes}}. Decision recorded via approval.' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: '{{trigger.candidateName}} cleared background check.' } },
        { id: 'n2', type: 'NOTIFY', config: { message: '{{trigger.candidateName}} background check resolved after HR review.' } },
      ],
      edges: [
        { from: 't1', to: 'h1' }, { from: 'h1', to: 'r1' }, { from: 'r1', to: 'a1' }, { from: 'a1', to: 'c1' },
        { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 'n1', branch: 'false' },
        { from: 'ap1', to: 'e1' }, { from: 'e1', to: 'n2' },
      ],
    },
    sampleTrigger: {
      candidateName: 'Neha Kapoor', email: 'neha.kapoor@yopmail.com', hrEmail: 'hr@kashif-it.com',
      notes: 'One prior employment discrepancy in dates reported by the verification vendor.',
    },
  },

  // --- Workflow 9: Internal Transfer -----------------------------------------
  {
    name: 'Internal Transfer',
    description: 'Employee transfer request -> transfer policy -> AI eligibility -> manager + HR approval -> Slack + email.',
    triggerType: 'MANUAL',
    triggerConfig: null,
    activateByDefault: true,
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'Transfer request', config: {} },
        { id: 'r1', type: 'RETRIEVE', name: 'Transfer policy', config: { k: 3, query: 'internal transfer policy', outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'Eligible?', config: { prompt: 'Is this employee eligible for internal transfer per policy? Reply ONLY true or false.\nEmployee: {{trigger.employeeName}}\nTenure: {{trigger.tenureMonths}} months\nCurrent team: {{trigger.currentTeam}}\nRequested team: {{trigger.requestedTeam}}\nPolicy: {{policy}}', outputKey: 'eligible' } },
        { id: 'c1', type: 'CONDITION', name: 'eligible == true', config: { op: 'eq', left: '{{eligible}}', right: 'true' } },
        { id: 'ap1', type: 'APPROVAL', name: 'Manager approval', config: { message: 'Current manager: approve {{trigger.employeeName}}\'s transfer to {{trigger.requestedTeam}}?' } },
        { id: 'ap2', type: 'APPROVAL', name: 'HR approval', config: { message: 'HR: confirm {{trigger.employeeName}}\'s transfer to {{trigger.requestedTeam}}?' } },
        { id: 's1', type: 'TOOL_ACTION', name: 'Slack notify', config: { tool: 'send_message', skillKey: 'slack', args: { channel: SLACK_CHANNEL, text: '{{trigger.employeeName}} is transferring to {{trigger.requestedTeam}}.' } } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email confirmation', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.email}}', subject: 'Transfer approved', body: 'Your transfer to {{trigger.requestedTeam}} has been approved.' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Transfer approved for {{trigger.employeeName}}.' } },
        { id: 'n2', type: 'NOTIFY', config: { message: '{{trigger.employeeName}} not eligible for transfer at this time.' } },
      ],
      edges: [
        { from: 't1', to: 'r1' }, { from: 'r1', to: 'a1' }, { from: 'a1', to: 'c1' },
        { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 'n2', branch: 'false' },
        { from: 'ap1', to: 'ap2' }, { from: 'ap2', to: 's1' }, { from: 's1', to: 'e1' }, { from: 'e1', to: 'n1' },
      ],
    },
    sampleTrigger: {
      employeeName: 'Divya Rao', email: 'divya.rao@yopmail.com', tenureMonths: '14',
      currentTeam: 'Support', requestedTeam: 'Engineering',
    },
  },

  // --- Workflow 10: Promotion Workflow ----------------------------------------
  {
    name: 'Promotion Workflow',
    description: 'Promotion request -> promotion policy -> AI eligibility -> director + HR approval -> email + Slack.',
    triggerType: 'MANUAL',
    triggerConfig: null,
    activateByDefault: true,
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'Promotion request', config: {} },
        { id: 'r1', type: 'RETRIEVE', name: 'Promotion policy', config: { k: 3, query: 'promotion policy', outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'Check eligibility', config: { prompt: 'Is this employee eligible for promotion per policy? Reply ONLY true or false.\nEmployee: {{trigger.employeeName}}\nTenure in role: {{trigger.tenureMonths}} months\nLast two ratings: {{trigger.ratings}}\nPolicy: {{policy}}', outputKey: 'eligible' } },
        { id: 'c1', type: 'CONDITION', name: 'eligible == true', config: { op: 'eq', left: '{{eligible}}', right: 'true' } },
        { id: 'ap1', type: 'APPROVAL', name: 'Director approval', config: { message: 'Director: approve promotion for {{trigger.employeeName}} to {{trigger.newTitle}}?' } },
        { id: 'ap2', type: 'APPROVAL', name: 'HR approval', config: { message: 'HR: confirm promotion for {{trigger.employeeName}} to {{trigger.newTitle}}?' } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email employee', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.email}}', subject: 'Congratulations on your promotion', body: 'You have been promoted to {{trigger.newTitle}}, effective next cycle.' } } },
        { id: 's1', type: 'TOOL_ACTION', name: 'Slack notify', config: { tool: 'send_message', skillKey: 'slack', args: { channel: SLACK_CHANNEL, text: '🎉 {{trigger.employeeName}} promoted to {{trigger.newTitle}}!' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Promotion approved for {{trigger.employeeName}}.' } },
        { id: 'n2', type: 'NOTIFY', config: { message: '{{trigger.employeeName}} not eligible for promotion at this time.' } },
      ],
      edges: [
        { from: 't1', to: 'r1' }, { from: 'r1', to: 'a1' }, { from: 'a1', to: 'c1' },
        { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 'n2', branch: 'false' },
        { from: 'ap1', to: 'ap2' }, { from: 'ap2', to: 'e1' }, { from: 'e1', to: 's1' }, { from: 's1', to: 'n1' },
      ],
    },
    sampleTrigger: {
      employeeName: 'Karan Shah', email: 'karan.shah@yopmail.com', tenureMonths: '18',
      ratings: 'Exceeds Expectations, Exceeds Expectations', newTitle: 'Senior Software Engineer',
    },
  },

  // --- Mega: Production Test (AI Recruiter) ----------------------------------
  {
    name: 'Production Test (AI Recruiter)',
    description: 'The single biggest end-to-end test: Gmail trigger -> Drive save -> HTTP parser -> Knowledge -> AI screening -> Condition -> HR approval -> email -> Calendar interview -> Slack -> Drive move -> Notify. Exercises ~all engine features in one run.',
    triggerType: 'EVENT',
    triggerConfig: gmailTrigger,
    activateByDefault: false,
    notes: 'Gmail-triggered — see module doc. Only one of RecruitAI / Workflow 1 / this may be ACTIVE at a time. The interview datetime is AI-computed (a1b) since there is no deterministic "N days from now" template helper — treat as a demo of the mechanism, not production-grade scheduling.',
    definition: {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'Gmail trigger', config: {} },
        { id: 'd1', type: 'TOOL_ACTION', name: 'Drive save resume', config: { tool: 'upload_file', skillKey: 'gdrive', args: { name: 'resume-{{trigger.from}}.txt', content: '{{trigger.cv}}' } } },
        { id: 'h1', type: 'TOOL_ACTION', name: 'HTTP resume parser', config: { tool: 'request', skillKey: 'http', args: { method: 'POST', url: RESUME_PARSER_URL, body: '{{trigger.cv}}' }, outputKey: 'parsed' } },
        { id: 'r1', type: 'RETRIEVE', name: 'Knowledge: hiring policy', config: { k: 5, query: 'hiring policy', outputKey: 'policy' } },
        { id: 'a1', type: 'AI_STEP', name: 'AI screening', config: { prompt: 'You are screening a job candidate against our hiring policy.\n\nSTEP 1 — Role match: check whether the candidate\'s actual role/discipline has a policy defined in the retrieved context (each policy defines its own eligible position(s), experience range, and salary band). If NONE of the retrieved policy content is for the candidate\'s actual discipline/role, the candidate does NOT qualify — score no higher than 40.\n\nSTEP 2 — Salary check: if the candidate has stated an expected/desired salary anywhere in the email or CV, compare it to the matched position\'s salary band. If their stated expectation is more than roughly 25% above the TOP of that band, this is a strong mismatch — score no higher than 50, regardless of technical fit.\n\nSTEP 3 — If (and only if) the role matches a defined position AND any stated salary expectation is reasonably compatible with its band, score 0-100 based on how well their experience/skills fit that position\'s requirements.\n\nRespond with ONLY a single integer between 0 and 100. No words, no punctuation, no % sign, no explanation — just the number.\n\nFrom: {{trigger.from}}\nEmail: {{trigger.body}}\nCV: {{trigger.cv}}\nPolicy: {{policy}}', outputKey: 'score' } },
        { id: 'c1', type: 'CONDITION', name: 'Condition: score > 79', config: { op: 'gt', left: '{{score}}', right: '79' } },
        { id: 'ap1', type: 'APPROVAL', name: 'HR approval', config: { message: 'Candidate {{trigger.from}} scored {{score}}/100. Proceed to interview?' } },
        { id: 'e1', type: 'TOOL_ACTION', name: 'Email candidate', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.from}}', subject: 'Interview invitation', body: 'Congratulations — you have been shortlisted (score {{score}}/100). We will confirm an interview slot shortly.' } } },
        { id: 'a1b', type: 'AI_STEP', name: 'Compute interview datetime', config: { prompt: 'Reply with ONLY an ISO 8601 UTC datetime string (e.g. 2026-08-01T10:00:00Z) for an interview 3 business days from now at 10:00 UTC. No explanation, no other text.', outputKey: 'interviewStart' } },
        { id: 'cal1', type: 'TOOL_ACTION', name: 'Calendar interview', config: { tool: 'create_event', skillKey: 'calendar', args: { title: 'Interview — {{trigger.from}}', start: '{{interviewStart}}' } } },
        { id: 's1', type: 'TOOL_ACTION', name: 'Slack notify team', config: { tool: 'send_message', skillKey: 'slack', args: { channel: SLACK_CHANNEL, text: '📅 Interview scheduled with {{trigger.from}} (score {{score}}/100).' } } },
        { id: 'g1', type: 'TOOL_ACTION', name: 'Move resume to Interviewing', config: { tool: 'move_file', skillKey: 'gdrive', args: { name: 'resume-{{trigger.from}}.txt', toFolder: 'Interviewing' } } },
        { id: 'n1', type: 'NOTIFY', config: { message: 'Production test run complete — candidate {{trigger.from}} through to interview scheduling.' } },
        { id: 'e2', type: 'TOOL_ACTION', name: 'Email rejection', config: { tool: 'send_email', skillKey: 'gmail', args: { to: '{{trigger.from}}', subject: 'Update on your application', body: 'Thank you for your interest. We will not be proceeding with your application at this time.' } } },
        { id: 'g2', type: 'TOOL_ACTION', name: 'Move resume to Rejected', config: { tool: 'move_file', skillKey: 'gdrive', args: { name: 'resume-{{trigger.from}}.txt', toFolder: 'Rejected' } } },
        { id: 'n2', type: 'NOTIFY', config: { message: 'Production test run complete — candidate {{trigger.from}} rejected (score {{score}}/100).' } },
      ],
      edges: [
        { from: 't1', to: 'd1' }, { from: 'd1', to: 'h1' }, { from: 'h1', to: 'r1' }, { from: 'r1', to: 'a1' }, { from: 'a1', to: 'c1' },
        { from: 'c1', to: 'ap1', branch: 'true' }, { from: 'c1', to: 'e2', branch: 'false' },
        { from: 'ap1', to: 'e1' }, { from: 'e1', to: 'a1b' }, { from: 'a1b', to: 'cal1' }, { from: 'cal1', to: 's1' }, { from: 's1', to: 'g1' }, { from: 'g1', to: 'n1' },
        { from: 'e2', to: 'g2' }, { from: 'g2', to: 'n2' },
      ],
    },
    sampleTrigger: {
      from: 'candidate2@yopmail.com', subject: 'Application for Staff Engineer',
      cv: 'Staff engineer, 9 years experience, distributed systems, led platform migrations at scale.',
    },
  },
];
