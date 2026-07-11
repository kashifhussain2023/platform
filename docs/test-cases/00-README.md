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
- **`05-ai-hr-edge-cases.md`** — HRAI (policy/onboarding), incl. the `HIGH_STAKES_ROLES`
  always-flag-for-approval behavior it shares with FinanceAI.
- **`06-ai-finance-edge-cases.md`** — FinanceAI (bookkeeping/expenses); documents the Stripe
  read-tool gap found and fixed this session.
- **`07-ai-project-manager-edge-cases.md`** — PMAI; documents the Jira read/transition-tool gap
  found and fixed this session (previously ONLY `create_issue` existed).
- **`08-ai-custom-roles-edge-cases.md`** — the 4 marketplace `CUSTOM`-role templates (Marketing/
  Procurement/Operations/Legal), grouped together since they share the generic runtime with no
  dedicated backend logic. Documents the Google Drive read-tool gap (critical for LegalAI) found
  and fixed this session.

## Marketplace capability audit (this session)

Cross-checked every marketplace employee template's stated job (`marketplace.catalog.ts`) against
its `suggestedSkills`' ACTUAL tools (`skills/catalog.ts`). Found and fixed 3 real "broken
promises" — a role advertising a capability with literally no tool to back it:

| Skill | Before | Gap | Fixed by adding |
|---|---|---|---|
| `stripe` | `create_payment_link` only | FinanceAI's "bookkeeping/expense checks" had zero read capability | `list_charges`, `get_balance` |
| `jira` | `create_issue` only | PMAI's "chase status updates" / OperationsAI's "monitor processes" couldn't read OR update anything | `list_issues`, `get_issue`, `transition_issue` |
| `gdrive` | `upload_file` only | LegalAI's "extracts clauses" (and every other role referencing docs) couldn't read ANY file back | `list_files`, `read_file` |

All 7 new tools live-verified (install skill → execute tool → correct mock response). Still
**mock-only** platform-wide for these skills — no real Stripe/Jira/Drive API integration exists
yet (only slack/http/gmail have a real executor); the tool SHAPES are now correct, real
implementations remain future work.

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
