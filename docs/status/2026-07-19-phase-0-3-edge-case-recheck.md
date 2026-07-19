# Double-check of Phase 0–3 fixes — edge cases found (2026-07-19)

**Status: all 9 gaps below are now fixed** (same day). Skip to each numbered
section for what changed; the short version:
1. Dry-run now fails loudly on an unknown/misconfigured skill+tool instead of showing a false "ok: true".
2. Budget check now re-runs on every step of a chat reply, not just once at the start.
3. A workflow run can no longer be started twice by two workers racing the same job.
4. Deleting a Yes/No step now asks for confirmation if it would drop one of the two paths.
5. Production now refuses to boot silently in fake AI/billing mode.
6. Cost figures are now labeled "(estimated)" everywhere they're shown.
7. Confirmed no real employee is affected today (checked the live database).
8. The audit log now has a real page (Organization → Audit Log).
9. Rate limits are now per-company, not per shared office/VPN IP.


**What this is:** After finishing Phase 0, 1, 2 and 3 of the master fix plan, I went back over
every change and tried to break it three different ways:
- As a **developer** — does the code actually do what it's supposed to, in every case?
- As a **business owner** — could this lose money, lose trust, or surprise a customer?
- As a **tester** — what's the exact click-by-click scenario that triggers the problem?

Nothing here is a "the whole thing is broken" situation. These are gaps worth knowing about,
ranked so you can decide what (if anything) to fix now versus later. I checked the real code for
every item below — nothing is guesswork.

---

## Already known and unchanged
The 5 P0s from the original founder audit that still need YOUR action (not more of my work):
rotate the leaked API keys, pick a real secrets manager, pick a hosting/CI provider, set up
Sentry (or similar) for error tracking, set up email delivery (SendGrid/Postmark/etc). Nothing
new to add there.

---

## New findings, most important first

### 1. Dry-run says "OK" even when the tool doesn't actually exist
**What happens:** When someone uses "Dry Run" to safely test a workflow step (e.g. "send an
email"), the system shows a preview and says `ok: true` — even if that step is pointing at a
skill/tool that was deleted, mistyped, or never connected in the first place.

**Why:** The code checks "is this a dry run?" *before* it checks "does this tool even exist and
is it connected?" So a broken step looks identical to a working one in dry-run mode.

**Business risk:** Someone tests a workflow, sees "success," turns dry-run off, and only then
discovers the step was never going to work — the safety net had a hole in exactly the case it
was supposed to catch.

**Tester scenario:** Build a workflow with a Tool step pointing at a skill key that doesn't
exist (typo it, or delete the skill afterward). Run it with Dry Run ON → you'll see a green
"would call X/Y" preview. Turn Dry Run OFF and run again → it fails immediately. That gap is the
bug.

**Fix effort:** Small — move the existence/connection check before the dry-run short-circuit,
so dry-run reports "this would fail" instead of "this would succeed."

---

### 2. Two people running the same AI employee at the same moment can both blow through the budget limit
**What happens:** When an AI employee has a monthly spending limit, the system checks "have we
gone over the limit yet?" and only *afterwards* records the cost of the request that just ran.
If two requests happen at almost the same time, both can pass the check before either one's cost
is written down — so the limit can be exceeded, not capped exactly at it.

**Why you'll now hit this more:** Earlier, the queue that runs workflow steps only allowed one
job at a time, which accidentally made this scenario rare. As part of Phase 1, I intentionally
raised that to 5 at once (a real, needed performance fix) — which makes this race condition
easier to actually hit, not just theoretical.

**Business risk:** A customer sets a hard budget limit expecting it to be a hard ceiling; in
reality it's a "soft, mostly-accurate" ceiling. Small overages, not runaway ones — but worth
being honest about if a customer asks "will I ever go a single cent over?"

**Tester scenario:** Fire two chat messages (or two workflow runs) at the same AI employee
within milliseconds of each other, right when it's close to its budget limit. Occasionally both
will succeed even though only one should have been allowed.

**Fix effort:** Medium — needs the budget check and the spend-recording to happen as one atomic
database operation instead of two separate steps. Not urgent unless a customer is actively
relying on an exact hard cap.

---

### 3. Same "check-then-act" pattern also affects duplicate workflow runs
**What happens:** Before a workflow run starts, the code checks "is this run still PENDING?" and
then, in a separate step, marks it "RUNNING." If the same run somehow gets picked up twice at
once (e.g. a retried job), both could pass the check before either flips the status — meaning a
workflow could run twice: two real emails sent, two calendar invites created, etc.

**Why this matters more now:** Same root cause as #2 — raising the queue's concurrency from 1 to
5 makes any timing-based double-execution bug easier to actually trigger, even though it wasn't
this fix's fault.

**Business risk:** Duplicate real-world side effects (double emails to a candidate, double
calendar invites) look unprofessional and are hard to explain to a customer.

**Fix effort:** Medium — same fix shape as #2 (make the check-and-flip one atomic step).

---

### 4. Deleting a "Yes/No" branch step in the visual workflow builder can quietly orphan one branch
**What happens:** If someone deletes a CONDITION (Yes/No) step in the workflow builder, the
builder tries to "heal" the gap by reconnecting whatever came before it to whatever came after
it. But a CONDITION step has *two* outgoing paths (Yes and No) — the healing logic only
preserves one of them, so the other path's steps become disconnected from the workflow and
silently stop being reachable.

**Business risk:** A workflow that looked complete in the builder quietly loses half its logic
the moment someone deletes the wrong step — no error, no warning.

**Tester scenario:** Build a workflow with a Yes/No step that leads to two different next steps.
Delete the Yes/No step. Whichever branch doesn't get preserved is now an orphaned island in the
canvas — it won't run, and there's no visual cue telling you it happened.

**Fix effort:** Small–medium — either warn the user before deleting a CONDITION node ("this will
disconnect one of two paths"), or offer to delete both branches together instead of silently
bridging one.

---

### 5. Nothing stops a real production deployment from quietly running in "fake" mode
**What happens:** Both the AI/LLM connection and the billing connection default to a safe,
offline "mock" mode unless an environment variable (`LLM_PROVIDER` / `BILLING_PROVIDER`) is
explicitly set to the real provider. I already added a safety check that blocks production from
starting with a weak encryption key — but there's no equivalent check for "are you sure you
meant to launch in mock AI / mock billing mode in production?"

**Business risk:** If a hosting environment is set up without one of those two environment
variables (a simple, easy-to-miss config mistake), the app doesn't crash or warn — it just quietly
serves fake AI replies or skips real billing, and everything *looks* like it's working.

**Fix effort:** Small — same pattern as the encryption-key check: refuse to start in production
if `LLM_PROVIDER`/`BILLING_PROVIDER` are unset or `mock`.

---

### 6. The "how much is this AI employee costing us" number is a flat estimate, not the real bill
**What happens:** Cost tracking uses one flat rate ($3 / $15 per million tokens) for every AI
employee, regardless of which real AI model is actually configured underneath. This is
clearly labeled as "illustrative" in the code, so it's a known simplification, not a bug — but
it's worth being upfront with customers about it.

**Business risk:** A customer could assume the dollar figure shown is their literal invoice from
the AI provider. If the real provider's pricing is meaningfully different, the two numbers won't
match, and the mismatch could look like a rounding bug to them instead of what it is (a rough
estimate).

**Fix effort:** Cheap fix now: add a small "(estimated)" label next to the cost figure in the UI.
Real fix later: use each real provider's actual price sheet per model instead of one flat rate.

---

### 7. Existing employees with a budget already set could suddenly start getting blocked
**What happens:** Before this work, `budgetLimit` was a saved-but-unused field — set it to
anything, nothing happened. Now it's actually enforced. Anyone who set a budget limit before,
purely as a label, will discover their AI employee starts refusing requests once it's crossed —
no advance warning that this changed.

**Checked against the real system:** I queried the live database — no employee on the real
Kashif Recruiting tenant currently has a budget limit set, so this isn't an active problem
today. It only matters the day a customer sets one for the first time, or if a demo/test company
had one set and is later mistaken for production data.

**Business risk:** Low today, but worth a one-line release note ("budget limits are now actively
enforced") if this ever ships to a customer who already has old budget values sitting around.

**Fix effort:** None needed code-wise — just a communication/changelog item.

---

### 8. The audit log (who-changed-what) has no screen — you can only see it by calling the API directly
**What happens:** Phase 2 added a real audit trail (role changes, workflow edits, skill
installs, security policy changes) and a `GET /audit-log` endpoint restricted to Owners/Admins.
Nobody built a page in the app to actually view it yet.

**Business risk:** "We have an audit log" is only half-true from a customer's point of view if
there's no way to see it without a developer manually calling the API.

**Fix effort:** Small–medium — a simple read-only table page under Organization settings.

---

### 9. Rate limiting is per-IP, not per-company
**What happens:** The login/register and workflow-generate limits (10 requests/minute) and the
overall 300/minute limit apply per IP address, not per company account.

**Business risk (two directions):** A big company where many employees share one office network
/ VPN could all get throttled together because of one IP's shared limit. On the flip side, this
doesn't protect one company's usage from affecting a totally different company sharing the same
IP (rare, but possible behind some corporate proxies).

**Fix effort:** Medium — would need login/company-aware rate-limit keys instead of IP-only;
lower priority than the items above, worth a P2/roadmap note rather than immediate action.

---

### Re-checked and downgraded (worth recording so it isn't re-flagged later)
Earlier reasoning suggested the budget-limit error message ("X has reached its monthly budget
limit ($Y)") could leak a company's financial details to an *external* customer. I re-checked
the actual code: the chat endpoint that returns this message requires a logged-in company
account (`JwtAuthGuard`) — there's no public/anonymous chat surface in this product today. So
the real (smaller) issue is: any logged-in team member using the chat — even a plain Member, not
just an Owner/Admin — can see the exact dollar figure of a budget an admin set. Minor, not a
customer-facing leak. Worth tightening later (e.g. a generic "budget reached, contact your
admin" message for non-admins) but not urgent.

---

## Suggested next step
None of these need to block anything — Phases 0–3 are solid and already tested. My
recommendation, in priority order, if you want me to keep going:
1. Fix #1 (dry-run false success) and #5 (mock-mode production guard) — both are small, cheap,
   and close real gaps in things you already believe are "done."
2. Fix #2 and #3 (the race conditions) together, since they're the same underlying pattern —
   medium effort, worth doing before a customer explicitly relies on hard budget caps or you
   push concurrency even higher.
3. Everything else (#4, #6, #7, #8, #9) is fine to leave as a backlog/roadmap item.

Tell me which ones (if any) you want fixed now, and I'll implement and test them the same way as
the earlier phases.
