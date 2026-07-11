# AI Support Agent — Edge Cases
Support employees run through the chat/runtime path (`AgentRuntimeService`), not the workflow
engine — so these edge cases center on the AI Employee runtime (plan → retrieve → memory → act →
validate) rather than workflow graphs. Executable today via `/employees` (hire a `SUPPORT`
employee) + chat, no email/Gmail required.

---

### SUP-01 — Role-scope guardrail: SUPPORT asked to do recruiting/HR work
**Steps:** hire a `SUPPORT` employee, chat: *"Please screen this candidate CV and give them a fit
score 0-100: 5 years Node.js backend experience, led a team of 4."*
**Expected:** decline, redirect to the recruiting employee — not attempt the scoring.
**Status:** ✅ **Handled** — **live-verified this session** against real GPT: the employee replied
*"I'm unable to screen candidate CVs or provide fit scores as this falls under recruiting
tasks. Please reach out to the recruiting AI employee..."*

### SUP-02 — Genuine in-role question still gets answered normally
**Steps:** same employee, chat: *"A customer says the app crashes when they click save. What
should I tell them?"*
**Expected:** a normal, helpful support answer — the guardrail must not over-refuse legitimate
in-role requests.
**Status:** ✅ **Handled** — live-verified this session; the employee gave a proper
troubleshooting-and-escalate answer with no refusal.

### SUP-03 — Question with zero relevant knowledge-base content
**Steps:** ask something the company's uploaded knowledge docs don't cover at all.
**Expected:** the employee should say so plainly rather than fabricate an answer, and the run
should show low `confidence`/`grounded: false` and likely `needsApproval: true`.
**Status:** ✅ **Handled by design** — `ValidationService` explicitly checks grounding/confidence
and flags for approval below `APPROVAL_CONFIDENCE_THRESHOLD`; the system prompt also explicitly
instructs "if the knowledge does not cover the question, say so plainly." 🧪 not separately
live-tested with a genuinely knowledge-gap question this session.

### SUP-04 — PAUSED/DISABLED employee receives a message
**Steps:** pause (or disable) a Support employee, then send it a chat message.
**Expected:** `409 Conflict`, not a silent failure or a response from a paused employee.
**Status:** ✅ **Handled** — this was verified as part of the original Employee runtime module
build (offline e2e: "rejects messages once the employee is PAUSED (409)").

### SUP-05 — Tool-calling loop exceeds the bound (needs 4+ tool calls to resolve)
**Scenario:** a support question needs to check order status, then check refund eligibility,
then check policy, then draft a reply — 4 distinct tool calls.
**Why it matters:** `MAX_ACT_ITERATIONS = 3` bounds the tool-calling loop per turn.
**Expected:** should degrade gracefully (best-effort answer with what it has) rather than error out
or silently truncate mid-task.
**Status:** 🧪 **Untested** — the bound exists and is enforced, but a genuine 4+-tool-call
scenario hasn't been exercised to observe the actual degraded output quality.

### SUP-06 — Approval-gated tool (e.g. issuing a refund)
**Scenario:** a Support employee is asked to process a refund, which is a `highRisk`
(or `approvalRules`-gated) tool.
**Expected:** creates a PENDING approval and pauses instead of executing directly.
**Status:** ✅ **Handled** — this is exactly the Approval Center's core design
(`ToolExecutorService` intercepts high-risk/`approvalRules`-gated calls); verified as part of the
original Approval Center module build.

### SUP-07 — Angry / all-caps / abusive customer message
**Scenario:** a hostile or ALL-CAPS message.
**Expected:** a calm, on-brand response — a soft (persona-driven) property, not a hard system
guarantee.
**Status:** 🧪 **Untested** — no explicit tone-handling logic exists beyond whatever `persona`
text the company writes; entirely dependent on prompt engineering, not a platform feature.

### SUP-08 — Multi-language support ticket
**Scenario:** a customer writes in a language other than English.
**Status:** 🧪 **Untested** this session — same caveat as REC-16 (GPT is multilingual but not
explicitly exercised here).

### SUP-09 — Very long conversation (memory beyond `RECENT_MESSAGE_LIMIT`)
**Scenario:** an ongoing support thread with 20+ back-and-forth messages.
**Status:** ⚠️ **Partial/known limitation** — same as SALES-05: only the last 10 messages are
loaded; older context relies on the `EmployeeMemory` FACT/summary mechanism, which can itself get
crowded past `RECENT_MEMORY_LIMIT` (5) — an explicitly deferred "semantic memory recall" item.
