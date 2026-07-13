# Production Workflows — 11 real workflows on the Kashif Recruiting tenant

All created via `scripts/production-workflows/`, all linked to the real `kashifhussain146@gmail.com`
tenant (id `cmrf5iewn0003cs6wap8fwpkd`). Every workflow below has been run at least once end-to-end
(with a real HR/manager approving via the API where a gate exists) and verified COMPLETED with real
tool effects (real Slack messages, real Gmail sends, real Calendar events, real Drive files).

## Scripts

| Script | What it does |
|---|---|
| `production-workflows/upload-policy-docs.mjs` | Uploads 7 placeholder policy documents to Knowledge (Leave/Offer/Salary Band/Payroll/Performance/Promotion/Transfer) — illustrative, replace with real policies when you have them. Idempotent. |
| `production-workflows/definitions.mjs` | The 10 workflow graphs (data, not a script) + their sample trigger payloads. Import this to see/edit the exact node graphs. |
| `production-workflows/create-all.mjs` | Creates/updates all 10 on the real tenant, idempotent by name. Activates everything except the two Gmail-triggered ones (see below). |
| `production-workflows/improve-leave-workflow.mjs` | Patches the existing "Leave Request -> Slack Notify" workflow (built earlier this session) to add an Email step and a Calendar "mark leave" step — this is Workflow 4. |
| `production-workflows/run-and-verify.mjs "<name>"` | Generic interactive runner for ANY of the 11 — runs with its sample trigger, pauses at every approval gate it hits and guides you to approve it for real in `/approvals`, then reports pass/fail + every step's outcome. |
| `production-workflows/verify-all.mjs` | Internal-only: same as run-and-verify but auto-approves via the API instead of pausing — used to structurally validate all the graphs in one pass. Not meant for your interactive use. |

Run order for a fresh setup: `upload-policy-docs.mjs` → `create-all.mjs` → `improve-leave-workflow.mjs`
→ `run-and-verify.mjs "<name>"` for whichever you want to exercise yourself.

## The 11 workflows

| # | Name | Trigger | Status | Skills exercised |
|---|---|---|---|---|
| 1 | Candidate Resume Screening (Production) | EVENT (Gmail) | **DRAFT** | Gmail, Drive, HTTP, Knowledge, AI, Condition, Approval, Slack |
| 2 | Offer Approval | MANUAL | ACTIVE | Knowledge (x3), AI (JSON + extraction), Condition, Approval, Gmail, Slack |
| 3 | Employee Onboarding | MANUAL | ACTIVE | AI, Drive, Calendar, Slack, Gmail |
| 4 | Leave Request -> Slack Notify (improved) | EVENT (internal) | ACTIVE | Knowledge, AI, Condition, Approval, Slack, Gmail, Calendar |
| 5 | Performance Review | SCHEDULE (monthly, 1st @ 09:00) | ACTIVE | Knowledge (x2), AI, Approval, Gmail, Slack |
| 6 | Exit Process | MANUAL | ACTIVE | Approval, Slack, Gmail, Drive, GitHub (mock) |
| 7 | Payroll Verification | SCHEDULE (monthly, 28th @ 09:00) | ACTIVE | Knowledge, AI, Condition, Approval, Gmail |
| 8 | Candidate Background Check | MANUAL | ACTIVE | HTTP, Knowledge, AI, Condition, Approval, Gmail |
| 9 | Internal Transfer | MANUAL | ACTIVE | Knowledge, AI, Condition, Approval (x2), Slack, Gmail |
| 10 | Promotion Workflow | MANUAL | ACTIVE | Knowledge, AI, Condition, Approval (x2), Gmail, Slack |
| — | Production Test (AI Recruiter) | EVENT (Gmail) | **DRAFT** | Every node type + every real skill in one graph |
| — | Candidate Details -> Fit Check | EVENT (`NEW_EMAIL_REPLY`) | ACTIVE | Knowledge, AI, Condition, Gmail, Slack — see "Candidate details-confirmation loop" below |

**Why #1 and the Mega workflow are DRAFT:** they share the exact same `EVENT/NEW_EMAIL` trigger as the
existing "New Candidate Email -> Screen -> Notify" (RecruitAI) workflow already live on this tenant.
Activating more than one Gmail-triggered workflow at once means every real inbound candidate email
fires ALL of them — duplicate scoring, duplicate Slack/email sends (the exact failure mode fixed
earlier this session, just with a second workflow instead of a self-notification loop). **Deactivate
RecruitAI before activating either one**, and only ever run one Gmail-triggered recruiting workflow
at a time:
```
POST /workflows/cmrf5ifg9000ncs6w6op01apq/deactivate   # the existing RecruitAI
POST /workflows/<id>/activate                            # whichever of #1 / Mega you want live
```

## What's real vs mock right now

Implemented this session — `apps/api/.../executors/real-skill-executor.ts`:
- **Calendar** (`create_event`) — real Google Calendar API. Needs the Calendar API enabled on the
  Google Cloud project and the `calendar` skill CONNECTED.
- **Google Drive** (`upload_file`, `create_folder`, `move_file`, `list_files`, `read_file`) — real
  Drive API v3 (multipart upload, folder search/create, parent add/remove for moves). Uses the
  `drive.file` OAuth scope, so it only ever sees files/folders this app itself created.
- **HTTP** (`request`) — was ALREADY real (the catalog description calling it "mock only" was stale
  and has been corrected) — SSRF-guarded real fetch.
- Already real before this session: **Gmail** (`send_email`), **Slack** (`send_message`, with
  automatic `#channel-name` → id resolution — see `docs/slack-google-connector-setup.md`).

Still mock (by design, not a gap to fix):
- **GitHub** `remove_collaborator` — deliberately has NO real executor case. Revoking a real
  developer's org access is destructive and hard to reverse; Workflow 6 (Exit Process) always
  simulates this step.
- The generic `email` skill was not used anywhere here — every "Email" step in the user's original
  designs is implemented via `gmail.send_email` instead, since Gmail is the skill with a real,
  connected send path.

## Real incidents found + fixed via live testing (2026-07-11)

Sending real CVs to `kashifhussain146@gmail.com` surfaced two genuine scoring gaps in RecruitAI's
`a1` "Score candidate" prompt (since patched, live, on RecruitAI, and mirrored into Workflow 1 /
Mega for consistency):

1. **Role-mismatch blind spot.** A "DevOps Engineer, 8 years" CV scored 85/100 and auto-shortlisted
   against a Hiring Policy whose salary bands are explicitly for Senior/Lead/Staff/Principal *Backend*
   Engineer — DevOps isn't a listed position at all. The prompt only checked years-of-experience, not
   whether the role itself is even covered by the policy. Fixed by adding an explicit role-match
   step (score capped at 40 if no retrieved policy covers the candidate's discipline) — re-tested,
   score dropped to 40 and correctly rejected. Once a placeholder "DevOps Hiring Policy.txt" was
   added to Knowledge, the SAME CV correctly re-scored 80 (fits the "Senior DevOps Engineer 6-9 yrs"
   band) — confirming the fix rejects on missing-policy, not on the role itself.
2. **Salary-mismatch blind spot.** A "Lead Engineer, 10 years" CV whose email body said *"I want a 1
   cr package"* (₹100 LPA) against a ₹45–60 LPA band scored 80/100 and auto-shortlisted — the prompt
   never checked the candidate's stated salary expectation against the matched band at all, and
   Workflow 1/Mega's prompts didn't even pass the email BODY to the model (only the CV). Fixed by
   adding a salary-check step (score capped at 50 if the stated expectation is >~25% over the band
   top) and adding `{{trigger.body}}` to every scoring prompt. Re-tested: score dropped to 40,
   correctly rejected.

Both fixes are scoring-prompt changes only — the workflow graphs, CONDITION logic, and approval gate
are unchanged. `autoApprove` is still `true` on RecruitAI's `ap1` (an explicit choice after these
findings — the user chose to improve the prompt rather than require human review per shortlist).

**Also found (and fixed) during this testing:** the "Candidate Resume Screening (Production)"
workflow got activated (from the `/workflows` UI) while RecruitAI was still ACTIVE, and both fired on
the same real inbound email — RecruitAI shortlisted it while the other workflow (different score,
LLM variance) rejected it, sending **contradictory emails to the same recipient** plus a real Drive
upload/move. Recipient was the user's own test account, not a real candidate, so no external harm —
but it's the concrete failure mode the "only one Gmail-triggered workflow ACTIVE at a time" warning
above is about. Re-confirmed PAUSED/DRAFT after.

**Duplicate/conflicting Knowledge doc found (and fixed):** an earlier placeholder
"Salary Band Policy.txt" (Software Engineer I/II/Senior/Staff-Lead bands, 6-40 LPA) directly
conflicted with the REAL "KASHIF RECRUITING — HIRING POLICY.pdf"'s own Salary Bands table (Senior/
Lead Backend Engineer/Staff/Principal, 30-80+ LPA) — RETRIEVE returned both, the placeholder scored
higher similarity, and the AI evaluated a candidate's compensation against the WRONG (much lower)
band, causing an incorrect reject. **Deleted** the placeholder doc; `upload-policy-docs.mjs` no
longer creates it. Lesson: don't invent a placeholder policy for something a REAL uploaded document
already covers — check `/knowledge` first, or RETRIEVE will surface both and the model may pick the
less-relevant one.

## Candidate details-confirmation loop (added 2026-07-11)

After a candidate is shortlisted, RecruitAI no longer sends "you're shortlisted, proceed to next
stage" — it emails the **candidate** asking them to reply with 5 details: Current CTC, Expected CTC,
Actual Experience, Joining Date, Notice Period. A second workflow, **"Candidate Details -> Fit
Check"** (`triggerType: EVENT`, `triggerConfig.eventType: 'NEW_EMAIL_REPLY'`), reacts to their reply,
re-evaluates those details against the hiring policy (role + salary band), and auto-sends a
confirmation or rejection email + Slack notify — no human approval gate in this second workflow (per
the user's spec: fully automatic accept/reject based on fit).

**The one code change this required** (everything else is workflow-only, as requested):
`gmail-inbound.service.ts` used to hard-skip EVERY threaded reply (`In-Reply-To`/`References`
headers present) — it would NEVER fire any workflow, by design, to stop a candidate's "thanks" reply
from being re-scored as a fresh application (the same class of bug as the self-notification loop
fixed earlier this session). That hard block has been changed to fire a **distinct event type**,
`NEW_EMAIL_REPLY`, instead of `NEW_EMAIL` for replies. Since `fireEvent` matches by exact `eventType`
string, every existing `NEW_EMAIL`-triggered workflow (RecruitAI, Workflow 1, Mega) is **completely
unaffected** — a reply still can't accidentally re-trigger them. Only a workflow that explicitly
opts in with `triggerConfig.eventType: 'NEW_EMAIL_REPLY'` receives replies at all.

Verified via `POST /workflows/events {"eventType":"NEW_EMAIL_REPLY", "payload":{...}}` (the same
call the real Gmail poller makes internally) with both a fitting reply (55 LPA expected, 10 years —
correctly confirmed) and a mismatched one (1 crore ask — correctly rejected).

## Gray-zone review band + a real approval-message bug (2026-07-11 evening)

Sending a genuinely strong real CV (Lead Backend Engineer, 10 yrs, exact salary-band match) to
`kashifhussain146@gmail.com` surfaced that LLM scoring is not stable near a hard threshold: the one
real run scored **70** and auto-rejected with zero human review; re-running the IDENTICAL input
immediately after gave **80, 80, 80, 80, 85**. A ~10-15 point swing is enough to flip a qualified
candidate across the 79/80 cutoff, and the reject path has no approval gate by original design.

**Fix:** added a gray-zone review band to RecruitAI's `a1`→`c1` scoring gate:
- score `> 79` → auto-approves (unchanged).
- score `65-79` → **pauses for a real HR approval** ("Borderline score... please review the CV and
  decide") instead of auto-rejecting.
- score `<= 64` → still auto-rejects, no gate (clear non-matches).

(In-graph CONDITION has no `gte`/`lte` — only `eq/neq/contains/gt/lt` — so "≥65" is expressed as
`gt 64` on integer scores.) All three paths verified live on the real tenant.

**Also found + fixed: the reply-handling workflow evaluated salary fit completely blind to the
candidate's role.** A candidate replied with "9 years experience, 40 LPA expected" — a strong match
for "Senior Backend Engineer (7-9 yrs): 30-45 LPA" — but got auto-rejected. Root cause: a reply
carries only follow-up numbers (no role/title), and the reply-processing workflow never had access to
the ORIGINAL CV/application, so its role-match check was blind. Fixed in `gmail-inbound.service.ts`:
when a message is a reply, look up the sender's most recent prior application (skipping past any
earlier replies, which also lack a `cv`) and carry its `cv`/`subject` into the fired event as
`originalCv`/`originalSubject`. Updated "Candidate Details -> Fit Check"'s prompt to use that context
to determine the actual role before checking the salary band. Verified live: identical reply, same
role context now included → fit flipped from `false` to `true`, full pipeline (slot claim → real
Calendar+Meet event → email → Slack) ran correctly.

**While building this, found a second, more serious, PRE-EXISTING bug**: paused/manually-gated
`APPROVAL` node messages were never template-resolved — `pauseForApproval` in
`workflow-engine.service.ts` stored `node.config.message` raw, unlike `execAutoApproval` which
correctly calls `resolveTemplate()`. Every manually-gated approval built this session (Offer
Approval, Promotion, Internal Transfer, Payroll Verification, Candidate Background Check, etc.) had
been showing literal `{{trigger.candidateName}}`-style text to HR reviewers in `/approvals` instead
of real values — unnoticed all session. Fixed with a one-line change in the engine itself (applies to
every workflow automatically, no per-workflow re-patching needed). Verified live: a borderline-review
message now correctly reads "Borderline score for borderline-test-2@yopmail.com — fit score
70/100..." instead of the raw template.

## Known structural limitations (flagged, not silently hidden)

- **SCHEDULE fires once per tick, not once per employee.** Performance Review and Payroll
  Verification are scheduled monthly, but the engine has no per-employee batch/loop primitive yet —
  each tick runs ONE review/verification. `trigger.*` is empty on the real scheduled tick; the sample
  triggers in `definitions.mjs` are for manual/demo runs only. A real per-employee cadence needs a
  batch-fan-out feature that doesn't exist yet.
- **No deterministic date arithmetic in templates.** The Mega workflow's interview scheduling
  computes the interview datetime via an AI_STEP asking GPT for "3 business days from now" — this is
  a demo of the mechanism, not production-grade scheduling (LLM date math is not perfectly reliable).
  Employee Onboarding instead requires the caller to supply `orientationStart` explicitly, which is
  the more reliable pattern for anything that actually needs to be correct.
- **CONDITION only compares two template-resolved strings** (eq/neq/gt/gte/lt/lte) — it cannot parse
  a field out of JSON. Workflow 2 (Offer Approval) asks the AI for full JSON (as requested) but then
  runs a second, tiny AI_STEP to extract just the boolean `eligible` field for the CONDITION node.
- **Knowledge policy documents are illustrative placeholders**, not your company's real policies —
  replace them via `/knowledge` whenever you have the real ones (same filenames will need re-upload,
  there's no in-place edit).
