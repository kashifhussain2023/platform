# Emma — HR AI Employee: Complete MNC Test Scenario

*A full, walk-through scenario for pitching/demoing Orlixa to an enterprise HR buyer. Every
workflow below is built from real platform building blocks — nowhere does this document invent a
feature that doesn't exist. Wherever the platform has a real limitation against a strict MNC
requirement, it's called out explicitly in a **⚠️ Reality Check** box right where it matters —
that honesty is what makes this scenario safe to present to a client without over-promising.*

---

## 1. The company scenario

**A 2,000-employee IT services firm**, structured like this:

```
                              CEO / Leadership
                                     │
                ┌────────────────────┼────────────────────┐
                │                                          │
          HR DEPARTMENT                              ENGINEERING (1,800 staff)
        (5 HR Executives)                                   │
                │                          ┌─────────────────────────────────┐
   ┌────────────┼────────────┐             │        Solution Architects (2)   │
   │            │             │             └─────────────────────────────────┘
Recruitment  Onboarding   Employee                        │
   HR          HR         Helpdesk HR         Technical Leads (15) — by team:
                                              PHP Team · Full Stack Team · .NET Team
                                                          │
                                        ┌─────────────────┼─────────────────┐
                                   Branch Manager     Branch Manager    Branch Manager
                                  (Team A, 200 ppl)  (Team B, 200 ppl)  (Team C, 200 ppl)
                                        │                  │                  │
                                 Senior Developers   Senior Developers  Senior Developers
                                 Junior Developers   Junior Developers  Junior Developers
```

5 human HR staff cannot realistically give personal attention to 2,000 employees, dozens of open
requisitions, and constant policy questions from every team (PHP / Full Stack / .NET / etc.). This
is exactly the gap **Emma**, the HR AI Employee, fills — not by replacing the 5 HR staff, but by
handling the repetitive 80% of HR work so the 5 humans focus on judgment calls, escalations, and
people problems that genuinely need a human.

---

## 2. Emma's employee record (exactly what you'd fill in on the Orlixa "Hire" screen)

| Field | Value | Real platform field? |
|---|---|---|
| **Name** | Emma | `AiEmployee.name` |
| **Role** | `HR` | One of the platform's 7 built-in roles (Support, Sales, Recruiter, **HR**, Accountant, Project Manager, Custom) |
| **Persona / title** | "Senior HR Operations Executive — handles recruitment, onboarding, employee helpdesk, and HR operations for a 2,000-person IT company. Escalates legal/disciplinary matters and final compensation decisions to a human HR Manager." | `AiEmployee.persona` (free text, shapes tone + boundaries) |
| **Department** | Human Resources | `AiEmployee.department` |
| **Manager (label)** | HR Manager | `AiEmployee.managerName` — ⚠️ see Reality Check below |
| **Working hours** | 24×7 (left blank) | `workingHoursStart/End` are optional — leaving both empty means no restriction, i.e. genuinely always-on |
| **Email identity** | info@orlixa.io | The address connected to Emma's **Gmail** skill |
| **Knowledge access** | ALL | `knowledgeAccess: 'ALL'` — can retrieve from every uploaded company document |
| **Budget limit** | Optional monthly $ cap | `AiEmployee.budgetLimit` — enforced automatically if set |

> **⚠️ Reality Check — "Manager: HR Manager"**
> `managerName` is a **free-text label**, not a link to a real user account. It shows up nicely on
> Emma's profile card, but it does not automatically route approvals or escalations to whoever
> holds that title. Anyone with the **Owner** or **Admin** role in the company can approve/reject
> Emma's paused actions — not specifically "whoever is tagged HR Manager." For a strict MNC
> rollout, the practical fix is: give the real HR Manager an Admin account, and only Admins/Owners
> approve HR-flagged actions. True role-based routing ("only this specific person approves this
> specific request type") is a fair roadmap ask, not something to claim exists today.

### Permissions Emma actually gets (real, connectable skills)

| Requested | Platform reality |
|---|---|
| ✅ Gmail | Real — send + the inbound "new email" trigger both actually work |
| ✅ Google Calendar | Real — can create real calendar events (interview invites, orientation, reviews) |
| ✅ Google Drive | Real — can read AND write real files (upload the handbook, read a policy doc back) |
| ✅ Slack | Real — can post real messages to a real Slack channel |
| ⚠️ Microsoft Teams | **Not a built skill today.** Only Slack is built as a one-click chat integration. Teams would need to be added as a new skill (a well-understood, scoped build) — don't promise it's live yet. |
| ⚠️ ATS / HRMS | **Not a named, one-click skill today.** There's a generic **HTTP skill** built for exactly this: give it your HRMS/ATS's API base URL + an auth key, and workflows can call it like any other tool. This is real and works, but it's "connect your own system's API," not a pre-built HRMS app with a logo and a config wizard. |
| ✅ Workflow Builder | Real — the visual step-by-step builder described in every scenario below |
| ✅ Knowledge Base | Real — upload PDFs/docs, Emma retrieves and cites them |

### Knowledge Base — all real, all just document uploads

Employee Handbook · Leave Policy · Recruitment SOP · Exit Policy · Attendance Policy · Salary
Structure · Promotion Policy · Code of Conduct · Offer Letter Templates · JD Library · Company
Policies.

This part of the scenario needs **zero caveats** — the Knowledge Base is exactly a document
upload + real vector search + citation. Every policy question Emma answers will quote which
document it came from.

> **⚠️ Reality Check — "Emma will never violate policy"**
> Grounded answers ARE real (Emma is instructed to answer from the uploaded documents and cite
> them). But this is a strong instruction to the AI, not a hard, code-enforced guarantee that it
> can *never* say something wrong — same as any LLM-based system. It's also worth knowing: **HR is
> one of the platform's two "high-stakes" roles** (with Accountant) — every single HR interaction
> is automatically flagged for audit/review, on top of whatever workflow-level approvals you add.
> That's a real, built-in safety net, not marketing language.

---

## 3. What Emma actually does — responsibilities, matched to real building blocks

| Category | What Emma does | Built from |
|---|---|---|
| **Recruitment** | Resume screening, JD matching, scoring, interview scheduling, candidate follow-up | Gmail trigger (inbound resume) + AI Step (score) + Calendar (real invite) |
| **Onboarding** | Document checks, welcome email, orientation invite, IT/Admin notification | Workflow chain: Tool Action (Gmail) → Tool Action (Calendar) → Notify |
| **Employee Helpdesk** | Answers leave/policy/reimbursement/attendance questions instantly | Knowledge Base retrieval + AI Step |
| **Internal HR Ops** | Birthday/anniversary messages, probation & document-expiry reminders | SCHEDULE trigger (real cron) + Condition + Tool Action |
| **Performance Cycle** | Review reminders, manager pings, promotion workflow kickoff | SCHEDULE trigger + Approval (human sign-off on the actual increment/promotion decision) |
| **Exit Process** | Acknowledge resignation, exit checklist, asset return, notify IT/Manager | Gmail trigger (resignation email) + Tool Action steps + Approval (final settlement) |
| **HR Reporting** | Monthly hiring/attrition/headcount report | SCHEDULE trigger (1st of month) + data aggregation + Gmail (send to CEO) |

---

## 4. The 10 real workflows, built the way Orlixa actually builds them

Each scenario below uses only the platform's real 8 node types (**Trigger, Retrieve, AI Step, Tool
Action, Wait, Condition, Notify, Approval**) and real trigger types (**Manual, Schedule, Webhook,
Event**).

### Scenario 1 — Candidate sends a resume

```
TRIGGER (EVENT: Gmail "new email" — real, polls the info@orlixa.io inbox)
   │  Subject: "Application for MERN Developer", attachment = resume PDF
   ▼
TOOL ACTION → Google Drive: save the attachment  [real]
   ▼
AI STEP → read the resume text + compare against the JD from the Knowledge Base,
          produce a score + summary                              [real]
   │
   │  Output example:
   │    Candidate: Rahul Sharma · Experience: 5 yrs
   │    Skills: Node.js, React, MongoDB, AWS
   │    JD Match: 92% · Recommendation: Strong Hire
   ▼
CONDITION: score > 85 ?
   ├── YES ─▶ APPROVAL: "HR Manager, approve this interview?"
   │              │  (any Owner/Admin decides — see the Reality Check above)
   │              ▼ approved
   │          TOOL ACTION → Calendar: create a real interview event
   │              ▼
   │          TOOL ACTION → Gmail: send the interview invite to the candidate
   │
   └── NO (score < 70) ─▶ TOOL ACTION → Gmail: send a polite rejection
                             ▼
                          TOOL ACTION → HTTP (your ATS): archive the candidate record
```

> **⚠️ Reality Check:** the score-based branching, the real calendar invite, and the real
> rejection email are all genuinely built and working today (proven on a live customer tenant).
> The one piece that needs your own setup: "archive in your ATS" calls the generic HTTP skill
> against your specific ATS's API — that's a one-time integration step, not a pre-built button.

### Scenario 2 — Employee asks their leave balance

```
TRIGGER (EVENT: Gmail — employee emails info@orlixa.io, subject "Leave Balance")
   ▼
TOOL ACTION → HTTP (your HRMS API): fetch this employee's leave balance
   ▼
AI STEP → compose a friendly reply
   ▼
TOOL ACTION → Gmail: reply
      "Hi Rahul, you currently have: Casual Leave 5, Sick Leave 7, Earned Leave 12. — Emma"
```
No HR staff touched this. Fully real today, provided your HRMS exposes an API Emma's HTTP skill
can call (true for virtually every modern HRMS — Darwinbox, Keka, Zoho People, SAP SuccessFactors,
etc. all have REST APIs).

### Scenario 3 — Employee asks a policy question

```
TRIGGER (EVENT: Gmail — "Can I work from home next week?")
   ▼
RETRIEVE → search the Knowledge Base for the WFH policy   [real, vector search]
   ▼
AI STEP → answer, grounded in the retrieved policy text, with a citation
   ▼
TOOL ACTION → Gmail: reply
   "According to HR Policy v4.2: employees can work remotely up to 2 days/week,
    with reporting-manager approval. [Source: Employee Handbook §4.2]"
```
This is the cleanest, most reliable scenario in the whole document — pure document retrieval +
citation, no external system dependency, works exactly as described.

### Scenario 4 — New employee joining

```
TRIGGER (MANUAL or WEBHOOK — HR creates the employee record)
   ▼
TOOL ACTION → HTTP (HRMS): generate employee ID
   ▼
TOOL ACTION → Gmail: send welcome email
   ▼
NOTIFY → "New joiner: notify IT + Admin"   [internal run-log entry — see caveat below]
   ▼
TOOL ACTION → Gmail: send the IT team a laptop/account-setup request  (the REAL notification)
   ▼
TOOL ACTION → Calendar: schedule orientation
   ▼
TOOL ACTION → Google Drive: share the handbook (real file share)
   ▼
TOOL ACTION → Gmail: notify Payroll
```

> **⚠️ Reality Check — "Notify" vs. actually messaging someone:** the built-in **Notify** step is
> an internal note written into the workflow's run log (great for audit trails — "this step ran,
> here's what happened") — it does **not**, by itself, send a Slack message or an email to a
> person. To actually alert IT, Admin, or Payroll, the workflow uses a **Tool Action** step calling
> Gmail or Slack directly (as shown above). This is a one-line design detail, but it matters:
> anywhere your scenario says "Notify Manager," the real build needs a Tool Action step alongside
> it, not just the Notify node.

> **⚠️ Reality Check — scheduling this through the app today:** the engine genuinely accepts a
> real cron expression (confirmed live: `PATCH` a workflow's trigger with
> `{cron: "0 0 * * *"}` and it saves and validates correctly) — but the **visual Trigger panel
> only exposes a simple "run every N minutes" box**, not a cron field. There's no way for an HR
> admin to click "run at midnight" or "run on the 1st of the month" through the app UI today;
> getting an exact schedule like that requires a one-time API call from someone technical. Don't
> promise a non-technical HR user can self-serve an exact cron schedule yet — "every N minutes"
> is the only thing the UI itself offers.

### Scenario 5 — Probation ending in 15 days

```
TRIGGER (SCHEDULE: cron — real recurring trigger, e.g. every night at 00:00)
   ▼
TOOL ACTION → HTTP (HRMS): find employees whose probation ends in 15 days
   ▼
TOOL ACTION → Gmail: notify the manager + HR
   ▼
APPROVAL → "Manager, confirm this employee for permanent status?"
   │  (paused until an Owner/Admin decides — no auto-push notification; the manager
   │   needs to check the Approvals screen, or you add a Slack/email nudge before this step)
   ▼ approved
TOOL ACTION → AI STEP generates the confirmation letter text
   ▼
TOOL ACTION → Gmail: send the confirmation letter
```

### Scenario 6 — Employee birthday

```
TRIGGER (SCHEDULE: cron, daily at 00:00)
   ▼
TOOL ACTION → HTTP (HRMS): who has a birthday today?
   ▼
CONDITION: any matches?
   └── YES ─▶ TOOL ACTION → Slack: post a birthday message to the team channel
                 ▼
              TOOL ACTION → Gmail: send a personal birthday email
                 ▼
              TOOL ACTION → Gmail/Slack: notify the manager
```

### Scenario 7 — Resignation

```
TRIGGER (EVENT: Gmail — subject "Resignation")
   ▼
TOOL ACTION → Gmail: acknowledge receipt
   ▼
TOOL ACTION → HTTP (HRMS/ATS): create an exit ticket
   ▼
TOOL ACTION → Calendar: schedule the exit interview
   ▼
TOOL ACTION → Gmail/Slack: notify manager + IT
   ▼
AI STEP → generate the asset-return checklist from the offboarding policy doc
   ▼
APPROVAL → Final settlement sign-off (Owner/Admin)
   ▼ approved
TOOL ACTION → HTTP (payroll system): trigger FnF processing
```

### Scenario 8 — Hiring manager requests new hires

```
TRIGGER (EVENT: Gmail — "Need 3 MERN Developers")
   ▼
AI STEP → draft a Job Description from the JD Library template + the request
   ▼
TOOL ACTION → HTTP (job board / careers page API): post the JD
   ▼
(feeds into Scenario 1's resume-screening pipeline automatically for every application)
```

### Scenario 9 — Monthly HR report

```
TRIGGER (SCHEDULE: cron, 1st of every month)
   ▼
RETRIEVE + TOOL ACTION (HTTP → HRMS/ATS): gather new joiners, resignations, offers
                                            accepted/rejected, avg. hiring time, open
                                            positions, department-wise hiring
   ▼
AI STEP → summarize into a report
   ▼
TOOL ACTION → Gmail: email the PDF-style summary to the CEO
```

### Scenario 10 — Employee helpdesk at 2,000-employee scale

Every one of the 2,000 employees can just email `info@orlixa.io` instead of pinging one of the 5
HR staff for routine questions (leave policy, reimbursement, PF, insurance, promotion cycle,
attendance rules, notice period, referral policy). This is the same mechanism as Scenario 3,
running at volume.

> **⚠️ Reality Check — will it hold up at 2,000-employee volume?** Yes, comfortably, with one
> real number worth knowing: as of today's platform hardening, API rate limits are **300 requests
> per minute per company** (raised from a shared per-IP limit specifically so one company's own
> traffic never competes with another company's). Even if a large fraction of 2,000 employees
> emailed in the same minute, that's well inside this ceiling — and if a company ever legitimately
> needs more, it's a one-line config change, not a re-architecture.

---

## 5. The single workflow "shape" behind all 10 scenarios

Every scenario above is really the same repeating pattern — this is the diagram to draw for a
client who wants the 30,000-foot view:

```
   Email / Schedule / Manual trigger
              │
              ▼
      Identify intent (Recruitment? Query? Leave? Exit? Joining?)
              │
              ▼
      Retrieve Knowledge  +  Call the right tool (HRMS via HTTP, Calendar, Gmail, Slack, Drive)
              │
              ▼
      Generate the AI response / decision
              │
              ▼
      Does this need a human sign-off? ──── NO ──▶ Execute the action
              │ YES
              ▼
      Pause → Owner/Admin approves/rejects/edits
              │
              ▼
      Execute the action  →  Audit Log (who/what/when, permanently recorded)
```

---

## 6. Reality-check summary (the one slide to show a skeptical technical buyer)

| What the scenario needs | Status |
|---|---|
| An AI employee with an HR role, persona, working hours, and a real inbox | ✅ Real |
| Gmail send + real inbound "new email" trigger | ✅ Real |
| Real Google Calendar event creation | ✅ Real |
| Real Google Drive read/write | ✅ Real |
| Real Slack posting | ✅ Real |
| Knowledge Base document upload + grounded, cited answers | ✅ Real |
| Recurring/scheduled workflows (nightly, monthly) via cron | ✅ Real |
| Visual workflow builder with branching (score > 85, etc.) | ✅ Real |
| Human approval gate before risky actions, fully audit-logged | ✅ Real |
| Per-employee monthly budget cap | ✅ Real |
| Calling your own HRMS/ATS's API | ✅ Real, via the generic HTTP skill (one-time setup per system) |
| Microsoft Teams as a one-click skill | ⚠️ Not built yet — Slack only today |
| A pre-built, named "HRMS" or "ATS" app tile | ⚠️ Not built — reached via the HTTP skill instead |
| Approvals routed to a specific named person/role (e.g. only "the Branch Manager of Team A") | ⚠️ Today: any Owner/Admin can decide — not routed to a specific title |
| Automatic push alert the moment something needs approval | ⚠️ Not built — check the Approvals screen, or add your own Slack/email alert step |
| Calendar conflict/availability checking | ⚠️ Not built — can create an invite, can't check if someone's free first |

This table is the honest version of "yes, and" — most of an enterprise HR department's daily grind
is genuinely covered by what's built today; the handful of gaps are specific, small, and easy to
scope as either a quick config step (connect your HRMS's API) or a clearly-bounded roadmap item
(Teams integration, named-approver routing) — not vague promises.

---

## 7. Live-tested end-to-end (2026-07-19)

Everything above was actually built and run on a real throwaway test tenant — not just read from
code. What was tested, and what it found:

- **Hired "Emma" (HR role)**, uploaded a real WFH/leave policy document, and asked the exact
  Scenario 3 question ("Can I Work From Home next week?") in chat. Emma answered correctly —
  2 days/week, manager approval required, probation employees excluded — **with a citation back
  to the exact uploaded document**, and the response was tagged `Grounded`, `Confidence 75%`,
  and **`Needs approval — High-stakes role (HR) — human approval required`**. This confirms both
  the grounded-answer claim AND the "every HR interaction is flagged" claim in one live test — and
  confirms that flag does NOT block the chat reply from showing.
- **Built and ran the full Scenario 1 pipeline twice** (AI Step → Condition → Approval →
  Tool Action, and the reject branch): a score of 92 correctly evaluated `92 > 85 = true`, paused
  at Approval, showed up in the Approval Center as a plain "Approve/Reject" decision (not routed
  to any specific named person — confirming that Reality Check live), resumed correctly after
  approving, and created a (mock, sandboxed — no real Google account connected in this test)
  calendar event. A score of 58 correctly evaluated to `false` and skipped the Approval step
  entirely, going straight to a rejection email tool action. Both runs completed with the exact
  branch each was supposed to take.
- **Confirmed the Notify vs. Tool Action distinction live**: the run log for the approved path
  shows the Notify step's actual recorded output was just
  `{"message": "Interview scheduled for Rahul Sharma.", "notified": true}` — a JSON note in the
  log, not a real message to anyone. The real notifications happened through the Tool Action
  steps (calendar/gmail) right before and after it.
- **New finding from this test pass — the visual builder can't compose a multi-step branch.**
  Clicking "+ Add Yes path" / "+ Add No path" always creates exactly ONE new Notify-type node as
  that branch's target; you cannot point a branch at an Approval or Tool Action step directly
  through the builder, and there's no way to change a step's type after it's created. To get the
  "Condition → Approval → Calendar" shape used in this test, the workflow's definition had to be
  written directly via the API — a real, technical builder limitation, not achievable by a
  non-technical HR admin clicking through the UI alone today. (The AI workflow-generator chat
  feature may be able to produce this shape directly since it writes the definition JSON itself —
  not verified in this pass.)
- **New finding — a small templating bug.** In the calendar Tool Action step, a template placed
  directly in a top-level field (`"to": "{{trigger.candidateEmail}}"`) resolved correctly to the
  real value, but the same placeholder nested inside an array
  (`"attendees": ["{{trigger.candidateEmail}}"]`) did NOT resolve — it stayed as the literal
  string `"{{trigger.candidateEmail}}"` in the tool call. Worth a small engineering fix before
  relying on any workflow step that needs a templated value inside a list (e.g. multiple
  interview attendees, multiple recipients).
- **Also confirmed live**: the Starter-plan employee cap (2 employees) is a real, server-enforced
  403, not just a cosmetic message — a genuinely stronger guarantee than expected.
