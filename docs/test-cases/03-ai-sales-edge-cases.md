# AI Sales Rep — Edge Cases
No live Sales workflow exists yet (only `RECRUITER` has a real production workflow today). This
file doubles as a **build checklist** — what to verify once a Sales workflow is built — proven
against the exact same generic engine that already powers RecruitAI, so most of it should "just
work" the same way. Each scenario notes which underlying engine capability it depends on (already
✅ from the workflow-engine file) vs. what's genuinely new/untested for a sales context.

---

### SALES-01 — Lead-intent scoring (mirrors RecruitAI's CV scoring)
**Scenario:** an inbound lead email ("interested in pricing for 50 seats") gets scored 0-100 for
buying intent, same pattern as candidate CV scoring.
**Depends on:** AI_STEP + CONDITION (✅ proven with RecruitAI).
**Status:** 🧪 **Not built** — mechanically identical to RecruitAI's scoring step; low risk once
built, same threshold-boundary and non-numeric-output caveats apply (see WF-A1/WF-A2).

### SALES-02 — High-value deal must NEVER auto-approve
**Scenario:** a $500k enterprise deal quote should always require human sign-off, unlike a
routine small-seat upgrade.
**Why it matters:** the `autoApprove` toggle (built this session) is a **per-node**, all-or-
nothing switch — there's no way to say "auto-approve only deals under $X." A Sales workflow using
`autoApprove` for speed would need a CONDITION gate specifically on deal size BEFORE the Approval
node (route small deals to an auto-approved path, large deals to a manually-gated one) — this
requires deliberate workflow design, not a platform feature; call it out explicitly so nobody
accidentally auto-approves a deal that should have had a human look at it.
**Status:** ⚠️ **Design responsibility, not a platform gap** — the capability exists
(CONDITION + separate Approval branches), but it must be deliberately wired per workflow.

### SALES-03 — Duplicate follow-up emails
**Scenario:** the SAME lead is processed twice (e.g. re-forwarded, or a re-send) and gets two
follow-up emails.
**Depends on:** the same de-duplication gap as REC-12 (no cross-event "is this the same person"
linkage) — would apply identically here. A lead getting two slightly different follow-ups reads
worse for sales than for recruiting (looks disorganized to a prospect).
**Status:** ❌ **Gap (shared with REC-12)**.

### SALES-04 — Role-scope guardrail: SalesAI asked to do recruiting/HR work
**Scenario:** in chat, ask the Sales employee to "screen this candidate CV and score them."
**Expected:** politely decline, redirect to RecruitAI.
**Status:** ✅ **Handled** — this is the EXACT guardrail built and live-verified this session
(originally tested with a SUPPORT employee refusing recruiting work; the mechanism
(`ROLE_SCOPE` + the forceful system-prompt instruction) is role-agnostic and applies identically
to SALES).

### SALES-05 — Multi-turn negotiation memory beyond the recall window
**Scenario:** a long back-and-forth negotiation thread (12+ messages) where an early message
committed to specific terms ("I can do $40/seat if you commit to a year").
**Why it matters:** `RECENT_MESSAGE_LIMIT = 10` — only the last 10 messages are loaded into
context. A commitment made in message #2 of a 15-message thread could be "forgotten" by message
#15, risking the AI contradicting an earlier promise.
**Status:** ⚠️ **Partial/known limitation** — semantic memory recall (retrieving OLD messages by
relevance rather than pure recency) is an explicitly deferred item in `CLAUDE.md`.

### SALES-06 — Currency/quote formatting in a TOOL_ACTION
**Scenario:** a TOOL_ACTION step sends a quote email with `{{price}}` templated in — does it
render `4999.999999999` instead of `$5,000.00` if the AI_STEP's raw numeric output isn't
formatted?
**Status:** ❌ **Gap (likely)** — the template resolver (`resolveTemplate`) does raw
`String(value)` stringification with no formatting/rounding step; any numeric AI output flows
through as-is.

### SALES-07 — Approval message clarity for a complex deal
**Scenario:** an Approval step's message needs to summarize a multi-line quote, not just one
`{{score}}` number (unlike RecruitAI's simple "fit score X/100").
**Status:** 🧪 **Not built** — same templating mechanism as RecruitAI's Approval message,
just needs a richer prompt/template design once a Sales workflow exists.
