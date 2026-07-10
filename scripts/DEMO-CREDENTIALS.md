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
