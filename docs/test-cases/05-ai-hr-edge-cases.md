# AI HR Assistant (HRAI) — Edge Cases
**Role:** `HR` · **Suggested skills:** email, calendar, gdrive · **Persona:** answers policy
questions, guides onboarding, supports the team day to day; defers legal/disciplinary matters to
a human. `HR` is one of only two roles in `HIGH_STAKES_ROLES` (with `ACCOUNTANT`) — every run is
flagged for human approval regardless of confidence, by design.

---

### HR-01 — Genuine policy question, grounded in the knowledge base
**Steps:** upload an HR policy doc, ask HRAI "how many paid leave days do I get?"
**Expected:** grounded answer citing the doc; still flagged `needsApproval: true` (high-stakes
role, always).
**Status:** ✅ **Handled by design** — same retrieval/validation path as Support (verified this
session), plus the `HIGH_STAKES_ROLES` override (`validation.service.ts`) forces approval
regardless of confidence — sensitive people-ops answers always get a human look before... actually
note: HIGH_STAKES only flags the run for approval in the analytics/audit sense; it does NOT block
the chat reply itself from being shown to the user. 🧪 confirm this distinction live if this
employee is ever wired into an approval-gated workflow, not just chat.

### HR-02 — Legal/disciplinary question ("can we fire someone for X?")
**Steps:** ask HRAI a question that's explicitly legal/disciplinary territory.
**Expected:** per persona, should decline and defer to a human — this is PERSONA text, not a
platform guarantee.
**Status:** ⚠️ **Partial** — the role-scope guardrail (built + verified this session) enforces
staying within the `HR` role's general scope, but "defer legal/disciplinary matters" is only in
the free-text `persona`, not a structural rule the platform enforces. A company relying on this
should verify it holds up under real GPT, the same way we verified the role-boundary refusal.

### HR-03 — Role-scope guardrail: HRAI asked to do Recruiter/Accountant work
**Steps:** ask HRAI to "score this candidate's CV" or "check our Stripe balance."
**Expected:** decline, redirect to the correct AI employee.
**Status:** ✅ **Handled** — same mechanism verified live this session (originally tested with
SUPPORT→RECRUITER refusal); `ROLE_SCOPE.HR` and the forceful system-prompt instruction apply
identically. 🧪 not separately re-run with HR specifically as the acting role.

### HR-04 — Onboarding scheduling (calendar)
**Steps:** ask HRAI to schedule an onboarding call for a new hire.
**Expected:** creates a calendar event.
**Status:** ✅ **Handled** — `calendar.create_event` exists and works (mock executor, verified
generically this session); no gap here. (No `list_events`/`check_availability` tool exists, so it
can propose A time but can't check for scheduling conflicts — minor, not a broken promise.)

### HR-05 — Reading an uploaded HR document from Google Drive
**Steps:** ask HRAI to "summarize the employee handbook from Drive."
**Expected:** can actually read the file's content.
**Status:** ✅ **Fixed this session** — `gdrive.read_file`/`list_files` were added (previously
ONLY `upload_file` existed — HRAI could put a file INTO Drive but never read one back out, which
would have silently broken this exact scenario). Live-verified generically (mock executor).

### HR-06 — No real Google Drive/Calendar backing yet
**Why it matters:** `RealSkillExecutor` only implements slack/http/gmail for real; gdrive and
calendar (like jira/stripe/hubspot) fall through to the mock executor regardless of connection
status (`SkillsService`'s `TODO: real executors for stripe/github/hubspot/jira/calendar/gdrive`).
**Status:** ⚠️ **Partial (platform-wide, not HR-specific)** — the TOOL DEFINITIONS are now
correct and complete for HRAI's stated job, but calling them against a real, connected Google
account doesn't yet actually happen — every call is mock/sandboxed until a real executor is
built. Not a regression; this was already true before this session's fixes for every non-
slack/http/gmail skill.
