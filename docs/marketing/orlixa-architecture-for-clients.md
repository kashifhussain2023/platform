# Orlixa — How the Platform Works (Client Explainer)

*A plain-language architecture overview, written for sales/founder conversations with a client —
not a developer document. Every technical fact in this document is checked against the real,
built code (not a roadmap wish-list) — nothing here is exaggerated so it stays safe to say out
loud to a client.*

---

## 1. The one-line pitch

**Orlixa lets a company "hire" AI employees the same way they hire humans** — give them a role,
connect the tools they need, teach them the company's knowledge, and put them to work. Each AI
employee works inside the company's own secure account, does real tasks (send emails, update a
CRM, screen a resume, answer a support ticket), and everything risky always pauses for a human's
sign-off first.

Think of it as: **a company gets its own private team of digital employees, running 24/7, that
plug into the tools it already uses.**

---

## 2. The 6-step mental model (this is what to draw on a whiteboard)

```
  1. HIRE          2. SKILLS          3. KNOWLEDGE        4. WORKFLOWS        5. APPROVALS        6. MEASURE
 ┌───────────┐    ┌───────────┐      ┌───────────┐       ┌───────────┐      ┌───────────┐       ┌───────────┐
 │  Pick a   │ →  │  Connect  │  →   │  Upload   │   →   │  Chain    │  →   │  Add a    │   →   │  Track    │
 │  role     │    │  tools    │      │  docs &   │       │  steps    │      │  human    │       │  results  │
 │ (Support, │    │ (Slack,   │      │  policies │       │  into an  │      │  sign-off │       │  on a     │
 │  Sales,   │    │  Gmail,   │      │  it must  │       │  automated│      │  for risky│       │  live     │
 │  Recruiter│    │  Calendar,│      │  follow   │       │  process  │      │  actions  │       │  dashboard│
 │  ...)     │    │  & more)  │      │           │       │           │      │           │       │           │
 └───────────┘    └───────────┘      └───────────┘       └───────────┘      └───────────┘       └───────────┘
```

Every client conversation can be walked through in this exact order — it maps 1-to-1 onto the
actual product screens (Employees → Skills → Knowledge → Workflows → Approvals → Analytics).

---

## 3. The building blocks (in plain words)

| Building block | What it is, in plain words |
|---|---|
| **AI Employee** | A named AI worker with a job title (Support, Sales, Recruiter, HR, Accountant, Project Manager, or a fully custom role), working hours, a manager, and a personality/persona. It remembers past conversations and stays "on-brand" for that company. |
| **Skills** | The tools an AI employee is allowed to use — Slack, Gmail, Google Calendar, Google Drive, Stripe, GitHub, Jira, HubSpot, and a generic HTTP connector for calling any other system's API (e.g. your own HRMS/ATS). A skill can be connected for the whole company or just for one employee (e.g. only the Recruiter gets the company's hiring inbox). |
| **Knowledge Base** | The company's own documents (PDFs, policies, FAQs, past support tickets) — uploaded once, and every AI answer is grounded in them and cites where it got the answer from, instead of making things up. |
| **Workflows** | A visual, no-code flowchart that chains steps together — "when a resume arrives → AI screens it → if it scores above 80 → notify the hiring manager → wait for approval → send the interview invite." Built from 8 simple building blocks: Trigger, Retrieve knowledge, AI step, Tool action, Wait, Condition (yes/no branch), Notify, and Approval. |
| **Approvals** | A safety switch. Any action a company marks as "risky" (e.g. sending money, making an offer) pauses and waits for a real person to approve, reject, or edit it before it happens. |
| **Analytics** | A dashboard showing tasks completed, hours saved, success rate, and pending approvals — so a business owner can see the ROI at a glance. |
| **Marketplace** | 15+ ready-made workflow templates (e.g. "screen resumes and auto-schedule interviews") a company can install in one click instead of building from scratch. |
| **Billing & Plans** | Four tiers — Starter (free, 2 employees), Pro ($49/mo, 10 employees), Business ($199/mo, unlimited employees + the workflow builder + integrations), and Enterprise (custom pricing, private deployment, SLA). Real Stripe billing underneath — upgrades, downgrades, and a self-serve billing portal. |

---

## 4. How a request actually flows through the system (one real example)

**Scenario: a candidate emails a resume to a hiring inbox.**

```
Candidate's email
        │
        ▼
┌───────────────────┐   1. A TRIGGER fires (new email received)
│   Workflow Engine   │
└───────────────────┘
        │
        ▼
┌───────────────────┐   2. An AI STEP reads the resume + the company's
│  Recruiter AI       │      hiring criteria (from the Knowledge Base)
│  Employee            │      and scores/summarizes the candidate
└───────────────────┘
        │
        ▼
┌───────────────────┐   3. A CONDITION checks: "is the score above 80?"
│   Yes / No branch    │
└───────────────────┘
     │           │
   Yes          No
     │           │
     ▼           ▼
┌─────────┐  ┌─────────────┐
│ APPROVAL │  │ Notify: send │  4a. If yes → pauses for a human
│ (hiring   │  │ a polite     │      recruiter to approve the interview
│ manager   │  │ decline      │      invite before it goes out
│ signs off)│  └─────────────┘
└─────────┘
     │
     ▼
┌───────────────────┐   5. Once approved → a real Google Calendar
│  TOOL ACTION        │      invite + Google Meet link is created and
│  (Calendar + Meet)   │      the candidate is emailed automatically
└───────────────────┘
```

Every one of those steps is logged. Nothing happens silently — a business owner (or an
auditor) can always see exactly what the AI did, when, and who approved what.

---

## 5. Under the hood (for the client's IT/technical stakeholder, kept simple)

- **One account per company** — every company gets its own fully separated space. One company's
  data is never visible to another; this is enforced on the server for every single request, not
  just hidden in the screen.
- **Modern, standard tech** — a NestJS (Node.js) backend, a Next.js web app, and a PostgreSQL
  database. Nothing exotic or hard to hire engineers for.
- **Background workflow engine** — automations run on a durable job queue (BullMQ/Redis), so a
  multi-step workflow keeps running reliably even if it takes minutes or needs to pause for a
  human approval in the middle.
- **AI provider flexibility** — the AI "brain" behind each employee is swappable (Anthropic Claude
  or OpenAI today; a mock/offline mode exists purely for safe testing and is blocked from ever
  running in a live production environment).
- **Smart retrieval, not guessing** — the Knowledge Base uses real vector search (pgvector) so an
  AI employee finds the most relevant paragraph in a 50-page policy document instead of skimming
  the whole thing every time.
- **Real usage & cost tracking** — every AI reply's token usage is recorded, converted to an
  estimated dollar cost, and can be capped with a monthly budget limit per employee.

---

## 6. Security & trust — only real, verified claims

*(This section deliberately does not claim things like "SOC 2 Compliant" or "GDPR Ready" — those
would need an actual paid audit/certification the company hasn't done yet. Everything below is
real and already built and tested.)*

| Claim | What backs it |
|---|---|
| **Tenant isolation** | A company's data is scoped by its verified login token on every single request — never by anything the browser sends, so it can't be spoofed. |
| **Data encryption** | Every connected credential (API keys, tokens) is encrypted at rest with industry-standard AES-256, never stored as plain text. |
| **Audit logs** | Every important change — role changes, workflow edits, new tool connections, security settings — is permanently logged with who did it and when. Owners/Admins can review it from an Audit Log screen. |
| **Role-based access** | Every team member is an Owner, Admin, or Member, and permissions are enforced on the server, not just hidden in the UI. |
| **Human approval gating** | Any action a company flags as risky (e.g. moving money) always pauses for a real person's sign-off — the AI can never do it unsupervised. |
| **Rate limiting** | Login and AI-generation endpoints are protected against abuse, scoped per company (so one company's traffic never throttles another's). |

---

## 7. What makes this a real, working product (not a mockup)

- A real company (**Kashif Recruiting**) is running this platform live today, with **11 production
  recruiting/HR workflows active**, real Google Calendar/Drive/Meet integration, and real
  candidate interview scheduling happening through it.
- **188 automated end-to-end tests + 80 unit tests** run before anything ships, covering login,
  billing, workflows, approvals, budgets, and security rules.
- The product has a working **self-serve billing flow** (Stripe), a **workflow builder** with real
  branching logic, a **dry-run/test mode** so a company can safely test a new automation before it
  touches anything real, and a full **audit trail**.

---

## 8. What's next (be upfront with the client about this)

Honest roadmap items, so nothing is overclaimed if a client asks "what about X":
- Formal SOC 2 / GDPR certification — not started; can be scoped once a client's deal size
  justifies the audit cost.
- Single sign-on (SSO) — not built yet; removed from the pricing page for the same reason (no
  selling what doesn't exist).
- Per-tenant encryption keys, dedicated/private hosting — available on the Enterprise tier as a
  custom deployment, not the shared default.

---

## 9. The 60-second client pitch (say this out loud)

> "Think of Orlixa as hiring a digital employee. You pick a role — say, a Recruiter — connect the
> tools it needs like Gmail and your calendar, upload your hiring policy so it always follows your
> rules, and then chain its work into an automated pipeline: screen resumes, score them, and
> schedule interviews. Anything risky always waits for your sign-off first. And you get a live
> dashboard showing exactly how much time and money it's saving you. It's not a chatbot — it's a
> real employee that happens to be AI, working inside tools you already trust."
