# Workflow Engine — Edge Cases (cross-cutting, "tight/tough" scenarios)

These apply to **any** workflow, regardless of which AI Employee it belongs to. Grounded in the
actual engine code (`apps/api/src/modules/workflows/engine/workflow-engine.service.ts`) and this
session's live fixes. Where a scenario references a real run, it's the RecruitAI workflow
(`cmrf5ifg9000ncs6w6op01apq`) on `kashifhussain146@gmail.com`.

---

## A. CONDITION node

### WF-A1 — Score exactly at the threshold boundary
**Scenario:** CONDITION is `{{score}} gt 79`. A candidate scores exactly **79** vs exactly **80**.
**Expected:** 79 → false (reject), 80 → true (approve) — `gt` is strict, boundary is correct.
**Why it matters:** off-by-one here silently flips a borderline candidate's outcome.
**Status:** ✅ **Handled** — verified live this session (score 10 → reject, score 95 → approve);
the exact boundary (79 vs 80) itself hasn't been separately live-tested. 🧪 for the literal
boundary value.

### WF-A2 — AI_STEP returns non-numeric text into a numeric CONDITION
**Scenario:** The scoring prompt asks for "ONLY an integer," but GPT occasionally returns
`"I'd estimate around 85"` instead of `"85"`.
**Expected:** should still parse to 85, or fail loudly — NOT silently misroute.
**Why it matters:** `compare()` does `Number(left) > Number(right)`; `Number("I'd estimate around 85")`
is `NaN`, and `NaN > 79` is always **false** — a genuinely strong candidate would silently get
**auto-rejected** with no error anywhere in the run log.
**Status:** ❌ **Gap** — no numeric-extraction fallback (e.g. regex-extract the first integer) and
no validation step flags a non-numeric AI_STEP output before it reaches CONDITION.

### WF-A3 — CONDITION true but no matching branch edge exists
**Scenario:** A misconfigured workflow has a CONDITION node whose `[true]` edge was deleted (e.g.
by manual DB edit or a future builder bug) but a `[false]` edge remains.
**Expected:** either fail loudly ("condition matched no edge") or a documented, safe fallback.
**Why it matters:** current fallback (`nextNode`) is `outgoing.find(branch match) ?? outgoing.find(no branch) ?? outgoing[0]`
— if only a `[false]` edge exists and the result is `true`, it falls through to **whatever edge
happens to be first in the array**, silently executing the wrong path with no error.
**Status:** ❌ **Gap** — no validation at save-time that both branches of a CONDITION are wired.

### WF-A4 — Empty `right` operand with `gt`
**Scenario:** CONDITION config has `right: ""` (empty string) with op `gt`.
**Expected:** should be treated as invalid config, not silently coerced.
**Why it matters:** `Number('')` is `0` in JS — `score gt ""` becomes `score > 0`, which is TRUE
for almost any positive score, effectively disabling the intended threshold.
**Status:** ❌ **Gap** — no config validation rejects an empty/non-numeric `right` for numeric ops.

### WF-A5 — `contains` op case-sensitivity
**Scenario:** `{{trigger.body}} contains "Node.js"` when the email says "node.js" (lowercase).
**Expected:** documented behavior either way — case-sensitive is defensible, but should be known.
**Status:** ⚠️ **Partial** — `contains` is a plain `String.includes()`, case-sensitive. Not
documented anywhere in the builder UI hint text.

---

## B. APPROVAL node (incl. the new `autoApprove` toggle)

### WF-B1 — Toggling `autoApprove` while a run is already WAITING
**Scenario:** A run pauses at Approval (old config: manual). Before anyone approves it, someone
edits the workflow and turns `autoApprove` ON, then saves.
**Expected:** does the ALREADY-WAITING run auto-resolve, or does it stay pending as originally
gated?
**Why it matters:** if you flip the toggle expecting it to "unblock" a stuck queue, you need to
know whether it actually does that or not.
**Status:** 🧪 **Untested** — by code reading, the paused run already has a `PENDING`
`ApprovalRequest` row created at pause-time; the toggle change only affects the NEXT run to reach
that node, not runs already waiting. Needs a live test to confirm this is actually true and to
decide if that's the desired behavior.

### WF-B2 — Reject vs. double-action race
**Scenario:** Two managers open the same approval and one clicks Approve while the other clicks
Reject within the same second.
**Expected:** exactly one outcome wins; the run doesn't end up in a corrupt/ambiguous state.
**Status:** 🧪 **Untested** — no advisory-lock-style guard was found on the approval
resolve path (unlike the employee-hire race we fixed this session). Worth a concurrent-request
test similar to the 5-parallel-hire test that verified the seat-limit fix.

### WF-B3 — Approval message references a template var that was never set
**Scenario:** The AI_STEP before CONDITION fails (LLM error) so `{{score}}` never gets written to
context, but the Approval message template still says `"...fit score {{score}}/100..."`.
**Expected:** either the run should never reach Approval (AI_STEP failure should fail the whole
run), or the message should degrade sensibly.
**Status:** ✅ **Handled by design, indirectly** — an AI_STEP throwing marks the step **FAILED**
and the whole run **FAILED** (per `runNode`'s catch → rethrow), so it never reaches Approval with
a missing `{{score}}` in the first place. The template resolver alone (`resolveTemplate`) would
otherwise silently render an empty string for a missing path — worth knowing if you reuse this
pattern elsewhere.

### WF-B4 — Large PENDING approval backlog
**Scenario:** 200+ PENDING approvals accumulate (e.g. Gmail poll fires faster than a manager can
review).
**Status:** 🧪 **Untested** — `/approvals` pagination/performance at this scale hasn't been
exercised.

---

## C. Concurrency / race conditions

### WF-C1 — Employee hiring at the seat limit (reference case, already fixed)
**Status:** ✅ **Handled** — fixed and live-verified this session (see
`docs/specs/hiring-and-subscription-linkage.md`): 5 concurrent hire requests at a 1-of-2 boundary
→ exactly 1 succeeds, 4 correctly blocked, via a per-company Postgres advisory lock. Included here
as the reference pattern for what "race-safe" looks like in this codebase.

### WF-C2 — Two workflow-definition edits from two browser tabs
**Scenario:** Two people (or two tabs) have `/workflows/<id>` open; both edit different steps and
both click Save.
**Expected:** a clear conflict signal, or at minimum no silent data loss.
**Why it matters:** `PATCH /workflows/:id` is a full-replace of `definition` with no
optimistic-concurrency check (no version/ETag) — the second Save **silently overwrites** the
first person's changes with no warning to either party.
**Status:** ❌ **Gap.**

### WF-C3 — Same candidate emails twice within one poll window
**Scenario:** A candidate sends a CV, then 10 seconds later sends a follow-up email ("also, my
portfolio is...") before the next poll cycle runs.
**Expected:** both should fire as two SEPARATE `NEW_EMAIL` events (correct — they're genuinely two
different messages), each independently scored.
**Status:** ✅ **Handled** — `dedupeKey` is per Gmail `messageId`, so distinct messages always
produce distinct CanonicalEvents/runs by design. (Whether firing the SAME workflow twice for one
candidate is *desirable* is a separate, real question — see recruiter file WF-REC-12.)

### WF-C4 — Cursor rebaseline near a message boundary
**Scenario:** Gmail returns 404 on a stale `historyId` (connector was disconnected for a while),
forcing a re-baseline. A message arrives in the exact window around the rebaseline.
**Expected:** no duplicate fire, no dropped message.
**Status:** 🧪 **Untested** — `rebaselined: true` is surfaced in `PollResult`, and RawEvent
dedup (unique on `connectorId`+`externalId`) should prevent a true double-fire, but the
"message right at the boundary gets silently dropped" case hasn't been specifically tested.

---

## D. Malformed / degenerate workflow graphs

### WF-D1 — Cyclic graph (an edge loops back to an earlier node)
**Scenario:** A misconfigured (or maliciously crafted) definition has `n3 → n1 → n2 → n3 → ...`.
**Expected:** bounded, not an infinite loop / hung worker.
**Status:** ✅ **Handled** — `MAX_WORKFLOW_NODES` caps total node visits per run; exceeding it
throws `"Exceeded max node count (...); aborting to avoid a loop"` and the run is marked
**FAILED** with that message. Not separately live-tested this session, but the code path is
unambiguous. 🧪 for a live confirmation.

### WF-D2 — Orphaned node (unreachable from TRIGGER)
**Scenario:** A step exists in `nodes` but no edge points to it.
**Expected:** either a build-time warning, or documented silent no-op.
**Status:** ❌ **Gap (minor)** — it just never executes; no validation warns the builder that a
step is dead code.

### WF-D3 — Duplicate node ids in one definition
**Scenario:** Two nodes share `id: "a1"` (possible via direct API/DB edit, not via the builder
UI which generates unique ids).
**Expected:** rejected at save-time.
**Why it matters:** `nodesById` is built as a `Map`, so the LAST node with that id silently wins
— the first is unreachable, with no error.
**Status:** ❌ **Gap** — no uniqueness validation on node ids server-side.

### WF-D4 — WAIT node requesting a duration over the cap
**Scenario:** `durationMs: 999999` on a WAIT step.
**Expected:** capped, not literally waited.
**Status:** ✅ **Handled** — silently clamped to `MAX_WAIT_MS`; the step's output records both
`requestedMs` and the actual `waitedMs`/`capMs` for auditability. (Durable/resumable long waits —
i.e. waiting *hours* via a delayed job instead of blocking a worker — remains a known TODO per
`CLAUDE.md`.)

### WF-D5 — Empty AI_STEP prompt
**Scenario:** `config.prompt` is blank (e.g. builder validation gap, or a template that resolves
to nothing).
**Status:** ⚠️ **Partial** — falls back to a literal `"Proceed."` prompt to the LLM rather than
failing — avoids a crash, but silently produces a low-value/nonsensical model call with no
warning surfaced anywhere.

### WF-D6 — Template referencing a typo'd context key
**Scenario:** A RETRIEVE step's `outputKey` is `policy`, but the AI_STEP prompt template says
`{{polic}}` (typo).
**Expected:** a build-time or run-time warning.
**Why it matters:** `resolveTemplate` silently resolves any missing path to an **empty string** —
the AI_STEP would run with a blank policy section and no error anywhere, degrading scoring
quality invisibly. This is exactly the class of bug we found (and fixed) with the trigger-payload
flattening earlier this session — it's easy for this to happen again with any new template edit.
**Status:** ❌ **Gap** — no validation cross-checks template `{{paths}}` against what upstream
steps actually populate.

---

## E. Connector / execution reliability

### WF-E1 — Gmail token revoked mid-poll-cycle
**Status:** ✅ **Handled** — `poll()` never throws (try/catch wraps the whole method); a failed
refresh is logged and treated as a no-op, and `ConnectorHealthService` drives the connector to
`DISCONNECTED` through the normal refresh-failure path.

### WF-E2 — TOOL_ACTION targets a DEGRADED/DISCONNECTED connector
**Status:** ✅ **Handled** — the engine explicitly checks connector health before calling
`SkillsService.runTool` and throws a clear, non-retryable "connector unavailable — step
quarantined" error, failing that step (and the run) cleanly instead of hammering a dead provider.

### WF-E3 — Tool-name collision (`email` vs `gmail`, both expose `send_email`)
**Status:** ❌ **Gap (flagged, not fixed)** — if a company has BOTH the generic `email` skill and
the `gmail` skill installed, a `TOOL_ACTION` step or agentic tool-selection could resolve to the
wrong one. Currently worked around by hardening approval rules, not root-fixed.

### WF-E4 — Subscription goes PAST_DUE while workflows are actively firing
**Scenario:** A company's card fails mid-day; their RecruitAI workflow keeps polling/scoring/
sending emails uninterrupted.
**Why it matters:** hiring is now gated on subscription status (fixed this session), but
**workflow execution and tool-calling are not** — a cancelled/past-due company can keep consuming
paid LLM API calls indefinitely.
**Status:** ❌ **Gap** — explicitly called out as a follow-up in
`docs/specs/hiring-and-subscription-linkage.md` Part E step 2 ("extend in a follow-up pass").
