# V-AEP Demo Company — Credentials & Contents

Seeded by `platform/scripts/seed-demo.mjs` driving the real HTTP API with offline
mock providers (`LLM_PROVIDER=mock`, `EMBEDDINGS_PROVIDER=hash`, `SKILL_EXECUTOR=mock`,
`BILLING_PROVIDER=mock`). Data persists in Postgres (`localhost:5433`, db `vaep`).

> The script is re-runnable: each run appends a unique `+<suffix>` to the login
> emails and creates a brand-new isolated tenant. The values below are from the
> reference run (suffix `1783700051172`). Re-run to get a fresh set:
> `node scripts/seed-demo.mjs` (optionally pass a suffix + base URL).

## Company
- **Name:** Acme Talent Inc  (industry: Staffing & Recruiting)
- **Company id / slug:** `cmrf4yfyp0001up0sc6tir1d3` / `acme-talent-inc`

## Logins (all password `Password123!`)
| Role   | Email                                        |
|--------|----------------------------------------------|
| OWNER  | `owner+1783700051172@acme.demo`              |
| ADMIN  | `recruit.admin+1783700051172@acme.demo`      |
| MEMBER | `hiring.manager+1783700051172@acme.demo`     |

## URLs
- **API base:** http://localhost:4000  (no route prefix; JWT bearer auth)
- **Web app:** http://localhost:3000

## How to view
From `platform/`: bring up infra (`docker compose -f infra/docker-compose.yml up -d`),
then `pnpm dev` (web :3000, api :4000). Open http://localhost:3000 and **log in as the
owner** above. Adminer (DB browser) is at http://localhost:8080.

## What each module now contains
| Module | Contents | Where to view |
|--------|----------|---------------|
| Organization / Team | 3 users (OWNER/ADMIN/MEMBER); 2 Departments (People, Engineering); Team "Backend Hiring" under Engineering; Security Policy (passwordMinLength 8, allowedEmailDomains []) | `/team`, `/organization` |
| Billing | Subscription upgraded STARTER → **BUSINESS** (unlimited employees) | `/billing` |
| Onboarding | Completed (`onboardedAt` set), departments RECRUITMENT + HR | post-login routing / `/onboarding` |
| Marketplace | Installed **RecruitAI** (RECRUITER) employee + "Recruiting: resume → score → schedule" workflow template | `/marketplace` |
| AI Employee | **RecruitAI** configured: dept People, manager HR Head, hours 09:00–18:00, tz America/New_York, knowledgeAccess ALL, budget 5000, permissions {sendEmail,scheduleMeeting}, approvalRules requireApprovalForTools=["slack:send_message"], goals + KPI targets (40 tasks/wk, 80% success) | `/employees`, `/employees/[id]` |
| Skills / Integrations | 4 installed + configured + **CONNECTED** (gmail, calendar, slack, http-as-ATS), all assigned to RecruitAI | `/skills`, employee skill picker |
| Knowledge (RAG) | 2 docs READY with chunks: Hiring Policy, Interview Process | `/knowledge` |
| Conversations | 2 conversations with RecruitAI (grounded Q&A + Slack announce) | `/employees/[id]` chat |
| Approvals | 2 ApprovalRequests, both **APPROVED**: (1) chat slack:send_message, (2) workflow HR-approves-interview | `/approvals` |
| Workflow | "New Candidate → Screen → Schedule" (TRIGGER→RETRIEVE→AI_STEP→APPROVAL→NOTIFY), EVENT trigger `NEW_CANDIDATE`, **ACTIVE**; 1 run **COMPLETED** (all 5 steps) | `/workflows` |
| Analytics | RecruitAI shows tasks/tool-actions/conversations/workflow runs > 0 with KPI attainment | `/analytics`, `/dashboard` |

## Completed RecruitAI scenario (end-to-end, verified)
1. **Grounded chat** — "How do we hire a Senior Backend Developer? Use our policy." → grounded reply citing 2 knowledge sources.
2. **Approval-gated Slack** — "Post a message to #hiring in Slack…" → slack:send_message routed to a PENDING approval (NOT executed) → approved → executed (SkillExecution logged), status APPROVED.
3. **Workflow approval** — fired `NEW_CANDIDATE` event → run paused at APPROVAL node (**WAITING**) with a WORKFLOW PENDING approval → approved → run **COMPLETED** (NOTIFY ran).

---

# Kashif Recruiting (live Gmail)

Seeded by `platform/scripts/seed-gmail-live.mjs` (real HTTP API, mock LLM/embeddings/billing,
`SKILL_EXECUTOR=auto`). A single real company owned by real Gmail addresses, with the **Gmail
connector INSTALLED but left `NOT_CONNECTED`** — the real Google OAuth flow is completed later
by the user. Sends are approval-gated for a safe first live test. NOT re-runnable as-is (fixed
real emails → a second `/auth/register` 409s).

## Company
- **Name:** Kashif Recruiting  (industry: Recruiting · country: India · tz: Asia/Kolkata)
- **Company id / slug:** `cmrf5iewn0003cs6wap8fwpkd` / `kashif-recruiting`

## Logins (password `Kashif@V-AEP2026`)
| Role  | Email                              |
|-------|------------------------------------|
| OWNER | `kashifhussain146@gmail.com`       |
| ADMIN | `kashifhussain.jaipur@gmail.com`   |

## Key IDs
- **RecruitAI employee id:** `cmrf5if03000bcs6wjvbvfd22` (role RECRUITER)
- **Gmail connector id (for OAuth connect):** `cmrf5if09000dcs6wxw8zuwcw`
- **Calendar connector id:** `cmrf5if0m000fcs6w32xoxipa`
- **Knowledge doc (Hiring Policy) id:** `cmrf5if1k000lcs6w4er9ppkz` (READY, 1 chunk)
- **Workflow id:** `cmrf5ifg9000ncs6w6op01apq` — "New Candidate Email -> Screen -> Notify"
  (TRIGGER→RETRIEVE→AI_STEP→APPROVAL→NOTIFY), EVENT trigger `NEW_EMAIL`, **ACTIVE**

## Gmail connector state & OAuth
- `InstalledSkill.connectionStatus = NOT_CONNECTED` (Gmail NOT fake-connected; OAuth is real).
- Gmail config: `companyEmail=kashifhussain146@gmail.com` (the catalog's send-address field —
  there is no `fromAddress` key on the gmail skill), `dailyEmailLimit=50`, signature set,
  canSend/canRead true.
- RecruitAI `approvalRules.requireApprovalForTools = ["gmail:send_email"]` → live sends are
  approval-gated.
- **`GET /skills/installed/cmrf5if09000dcs6wxw8zuwcw/oauth/authorize` (as owner) → HTTP 400**
  with message **`OAuth not configured for google`** (expected until `OAUTH_GOOGLE_CLIENT_ID` /
  `OAUTH_GOOGLE_CLIENT_SECRET` / `OAUTH_REDIRECT_BASE` env are set on the API; then this
  endpoint returns the Google authorize `url` the browser is sent to, and the public
  `GET /skills/oauth/callback` completes the connect → `CONNECTED`).

## DB-verified counts (company-scoped)
company 1 · users 2 · RecruitAI (RECRUITER) 1 · gmail InstalledSkill NOT_CONNECTED 1 ·
installed skills 2 (gmail+calendar) · EmployeeSkill 2 · knowledge READY 1 · ACTIVE workflow 1.

---

# Kashif Recruiting — seeded flow data

Additive, production-realistic recruitment-operation dataset layered onto the
EXISTING live company **Kashif Recruiting** by `scripts/seed-flow-kashif.mjs`
(re-runnable; drives the running API at http://localhost:4000). The running API
uses a LIVE skill executor, so slack is deliberately left NOT_CONNECTED to force
the offline MOCK executor (deterministic SUCCESS, no real network calls).

- **Company id:** `cmrf5iewn0003cs6wap8fwpkd` (asserted at seed time)
- **Owner login:** kashifhussain146@gmail.com / Kashif@V-AEP2026
- **AI employee:** RecruitAI `cmrf5if03000bcs6wjvbvfd22` (RECRUITER, ACTIVE)

## Team (members, password Kashif@V-AEP2026)
- priya.sharma+<suffix>@kashifrecruiting.com (MEMBER, login verified)
- ravi.kumar+<suffix>@kashifrecruiting.com (MEMBER)
- Users total = 4 (1 OWNER, 1 ADMIN, 2 MEMBER). Idempotent: re-runs reuse members.

## Final state (DB-verified, company-scoped)
- **Billing:** Subscription = BUSINESS / ACTIVE.
- **Org:** Departments People + Engineering; Team Backend Hiring.
- **Skills installed:** slack, http, gmail, calendar — all assigned to RecruitAI
  (EmployeeSkill = 4). All NOT_CONNECTED (mock execution; gmail/calendar left as-is).
- **Knowledge:** 4 docs, all READY (Hiring Policy + Senior Backend JD + Salary
  Bands 2026 + Interview Scorecard & Rubric).
- **Conversations:** 14 (14 USER + 14 ASSISTANT msgs). Includes grounded Q&A
  (sources=4, grounded=true), slack actions, and an email-invite action.
- **SkillExecution:** slack send_message SUCCESS x2 (mock). NO gmail/email executions.
- **Workflow runs (NEW_EMAIL):** 12 total — COMPLETED 6, WAITING 4, FAILED 2
  (FAILED = runs whose HR approval was REJECTED).
- **Approvals:** APPROVED 6 (workflow), PENDING 5 (4 workflow + 1 email:send_email
  chat), REJECTED 2 (workflow).
- **Learning:** EmployeeFeedback 6 (UP 4 / DOWN 2); 2 FACT EmployeeMemory rows
  (source FEEDBACK) = 'Always require 3+ years experience for senior roles.'
- **Analytics /overview:** toolActions 2 (success 2, errors 0), conversations 14,
  assistantMessages 14, workflowRuns 12, workflowCompleted 6, pendingApprovals 5,
  tasksCompleted 22, successRate ~0.57 — all > 0.

## Safety — zero real emails
gmail is NOT_CONNECTED (mock). The chat email-invite action is APPROVAL-GATED and
left **PENDING** (never approved) — no send. Note: the mock LLM maps the send_email
tool to skillKey `email` (catalog-order collision: 'email' precedes 'gmail'), so the
pending request is recorded as `email:send_email` (kind TOOL); RecruitAI's
approvalRules were additively hardened to gate `gmail:send_email`, `email:send_email`
and `email` so ANY email-send intent pauses for approval. There are zero gmail/email
SkillExecution rows; no gmail/email approval was ever approved.

## Notes
- Script was run twice during iterative hardening (slack executor + email gate),
  so conversation/workflow-run history is ~2x the single-pass targets (richer, still
  a valid mix). Users + knowledge are idempotent and stayed at 4 / 4.
- Regenerate/extend: `node scripts/seed-flow-kashif.mjs [suffix] [baseUrl]`.
