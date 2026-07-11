# AI Accountant (FinanceAI) — Edge Cases
**Role:** `ACCOUNTANT` · **Suggested skills:** stripe, email, gdrive · **Persona:** bookkeeping
questions, expense review, finance summaries; flags anomalies, routes money movement to human
approval. `ACCOUNTANT` is one of only two `HIGH_STAKES_ROLES` (with `HR`) — every run is flagged
for approval regardless of confidence.

---

### FIN-01 — "What's our current Stripe balance?"
**Steps:** ask FinanceAI for the account balance.
**Expected:** should be answerable via a real tool call, not a guess.
**Status:** ✅ **Fixed this session** — `stripe.get_balance` was added (previously Stripe's ONLY
tool was `create_payment_link` — FinanceAI's core "bookkeeping questions" job had **zero** read
capability). Live-verified generically (mock executor echoes a sandboxed response).

### FIN-02 — "Review our recent charges for anything unusual" (anomaly-flagging persona promise)
**Steps:** ask FinanceAI to review recent transactions for anomalies.
**Expected:** can retrieve a list of real charges to actually reason over.
**Status:** ✅ **Fixed this session** — `stripe.list_charges` was added. The actual "flag
anomalies" REASONING is prompt/persona-driven (LLM judgment over whatever `list_charges` returns),
not a dedicated anomaly-detection algorithm — reasonable for a v1, but worth knowing it's not a
statistical/rules-based check.

### FIN-03 — Creating a payment link is HIGH-RISK — always gated
**Steps:** ask FinanceAI to create a payment link for a customer.
**Expected:** never executes directly; always creates a PENDING approval first.
**Status:** ✅ **Handled by design** — `create_payment_link` has `highRisk: true` in the catalog,
which `ToolExecutorService`/`ApprovalService` intercepts unconditionally (this was true before
this session, unrelated to the new read tools — `list_charges`/`get_balance` are correctly NOT
marked highRisk since they only read, never move money).

### FIN-04 — Role-scope guardrail: FinanceAI asked to do HR/Recruiter work
**Status:** ✅ **Handled** — same mechanism verified live this session; `ROLE_SCOPE.ACCOUNTANT`
applies. 🧪 not separately re-run with ACCOUNTANT specifically as the acting role.

### FIN-05 — No real Stripe backing yet (mock-only)
**Why it matters:** even with the new tool definitions, `list_charges`/`get_balance`/
`create_payment_link` all still fall through to the MOCK executor — there is no real Stripe API
call anywhere yet (`RealSkillExecutor` only implements slack/http/gmail for real).
**Status:** ⚠️ **Known, platform-wide** — a company relying on FinanceAI for REAL bookkeeping
today would get plausible-looking but entirely fabricated (sandboxed echo) numbers, not real
account data. This needs a real `StripeExecutor` (reading actual Stripe API `/charges`/`/balance`)
before FinanceAI's stated job is truly capable, not just "has the right tool shape."

### FIN-06 — Expense document lives in Google Drive
**Steps:** ask FinanceAI to "summarize the expense report in Drive."
**Expected:** can read the file.
**Status:** ✅ **Fixed this session** — `gdrive.read_file` now exists (previously only
`upload_file`); same fix as HR-05/LEGAL-01. Still mock-only per FIN-05's caveat (no real Drive
read happens yet).
