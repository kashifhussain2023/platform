# V-AEP Edge-Case Test Catalog
**Date:** 2026-07-11 · **Purpose:** answer "how scalable/robust is our workflow feature for every
realistic scenario?" with concrete, executable test cases — not automated code, but a reviewable
catalog you (or a tester) can run by hand, each with an explanation of *why it matters* and its
*current status* based on this session's actual code investigation + live verification.

## How this catalog is organized

- **`01-workflow-engine-edge-cases.md`** — cross-cutting engine stress-tests (CONDITION,
  APPROVAL, concurrency, malformed graphs). The single most important file — this is where
  "tight/tough workflow scenarios" live, regardless of which AI Employee owns the workflow.
- **`02-ai-recruiter-edge-cases.md`** — RecruitAI-specific, all executable TODAY against the
  real connected inbox **`kashifhussain146@gmail.com`** (the only employee with a fully live,
  production workflow right now).
- **`03-ai-sales-edge-cases.md`** — AI Sales Rep scenarios. No live Sales workflow exists yet;
  these double as a **build checklist** — what to verify once one is built, proven against the
  same generic engine that already powers RecruitAI.
- **`04-ai-support-edge-cases.md`** — AI Support Agent scenarios, including the role-scope
  guardrail we built and live-verified this session.

## Status legend (used in every file)

| Mark | Meaning |
|---|---|
| ✅ **Handled** | Verified this session (either live-tested or confirmed by direct code reading) |
| ⚠️ **Partial** | Works, but with a caveat/limitation worth knowing |
| ❌ **Gap** | Not handled today — a real failure mode, needs work |
| 🧪 **Untested** | Plausible based on code, but not actually exercised live this session |

## Test environment (assumed by every scenario below)

- Company: **Kashif Recruiting** (`cmrf5iewn0003cs6wap8fwpkd`), owner `kashifhussain146@gmail.com`
  / `Kashif@V-AEP2026`.
- Gmail connector: **CONNECTED** (real OAuth) on `kashifhussain146@gmail.com` — inbound polling
  every ~60s (or `POST /connectors/:id/poll` for instant).
- `LLM_PROVIDER=openai`, `EMBEDDINGS_PROVIDER=openai` — real GPT scoring, not mock.
- Send test emails/CVs from any external account (e.g. `kashifhussain.jaipur@gmail.com`) **to**
  `kashifhussain146@gmail.com`.
- After sending: wait for the poll (or trigger it manually), then check `/workflows/<id>` (run
  log), `/approvals`, and the recipient's inbox for the actual reply email.

## How to use this

1. Pick a file matching what you want to stress-test.
2. Run the scenarios marked 🧪 first — those are the ones we genuinely don't know the answer to
   yet.
3. For every ❌ Gap you want closed, say so and it becomes a scoped fix (same pattern as the
   billing-gating and edge-flattening fixes already shipped this session).
