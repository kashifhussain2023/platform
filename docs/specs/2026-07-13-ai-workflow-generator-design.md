# V-AEP Platform — AI Workflow Generator (Design Spec)

**Date:** 2026-07-13 · **Status:** Approved (pending final spec review) · **Scope:** a chat-based "describe what you need, AI builds the workflow" feature inside the existing Workflows module.

## Goal
Let a user (e.g. an HR manager) describe a need in plain language ("screen new resumes and schedule
interviews for React roles") and have AI produce a working draft `Workflow` — instead of hand-building
one node at a time in the existing builder. Gated to **BUSINESS/ENTERPRISE** plans only.

**Hard constraint (drives every decision below):** zero new Prisma models, zero new migrations, zero
new top-level module. This is an extension of the existing `modules/workflows` slice — same pattern as
adding a new controller method to an existing controller, not a new domain.

## User flow
1. On the existing `/workflows` page, a **"Generate with AI"** button appears next to "+ New Workflow"
   — visible only for BUSINESS/ENTERPRISE companies (a UI nicety; the real gate is server-side, see below).
2. Clicking it opens a small chat panel. The user describes their need in one message.
3. AI can ask follow-up questions (department, whether an approval step is needed, etc.) — **capped
   at 3 rounds.** After the 3rd user reply, the next response must be a draft (with placeholders per
   the fallback strategy below for anything still unclear), never another question. This bounds the
   chat and guarantees the user always reaches a usable draft in a predictable number of turns.
4. Once ready, AI returns a complete draft **workflow definition** (nodes + edges, same shape the
   builder already produces by hand) — grounded in the company's real installed skills and real hired
   AI employees, per the user's choice of "Option 1."
5. The draft opens in the **existing workflow builder screen**, pre-filled, exactly as if the user had
   built it by hand. Nothing is saved yet. The user reviews/edits like any other draft, then clicks the
   existing **Save**. Nothing runs or activates until they explicitly do so — identical to today.
6. If the user doesn't like the direction mid-chat, a **"Start over"** control resets the chat with no
   side effects (nothing was ever persisted).

## Why the AI-generation endpoint never touches the database
The generation step itself is **pure**: LLM call in, validated JSON out — `WorkflowGeneratorService`
never writes to the database, and it reuses the *existing* create-workflow path for persistence instead
of inventing a new one:
- The chat itself is never saved. `Conversation`/`Message` (used for AI-employee chats) require a real
  `employeeId` — can't be repurposed here without a schema change, which is off the table. The running
  chat transcript is simply passed back and forth with each request (kept in frontend component state).
- As shipped, the **frontend** creates the real workflow immediately: as soon as a `type:'draft'` result
  comes back, `GenerateWorkflowChat` calls the existing `useCreateWorkflow` hook — the same
  `WorkflowsService.create()` path a hand-built workflow already uses — persisting a real **DRAFT-status**
  `Workflow` row right away, then navigates the user to its builder/detail page. There is no separate
  unsaved-preview UI; the builder only ever knows how to open a workflow by id. This is a deliberate
  refinement of an earlier draft of this spec (recorded in
  `docs/plans/2026-07-13-ai-workflow-generator-plan.md`, "Global Constraints"). The safety net is not
  "nothing is saved" — it's that nothing **runs or activates** until the user explicitly does so, and an
  unwanted draft is simply removed via the builder's existing delete action, exactly as if a human had
  abandoned a hand-built draft mid-edit.

## API surface (new methods on the *existing* `WorkflowsController`/`WorkflowsService`, no new module)
`POST /workflows/generate` — body: `{ messages: {role:'user'|'assistant', content:string}[] }`
(the frontend sends the whole conversation so far each time; the endpoint itself keeps no state).
Response is one of:
- `{ type: 'question', message: string }` — AI needs more info; frontend appends it to the chat and
  waits for the next user reply.
- `{ type: 'draft', definition: WorkflowDefinitionDto, warnings: { nodeId: string; reason: string }[] }`
  — a ready-to-review draft. Each `warnings` entry names the exact `nodeId` inside `definition` that
  the AI couldn't confidently fill in (see fallback strategy below), so the builder UI can highlight
  that specific node rather than a generic "something's wrong" message.

No new DTOs beyond a small request/response pair for this endpoint; the draft's shape is the
**existing** `WorkflowDefinitionDto` used by manual creation today — this is what keeps it from ever
producing something the rest of the system doesn't already know how to run.

## Plan gate (the first real plan-enforcement in the codebase — noted explicitly)
Today, `Subscription.plan` exists but nothing enforces it anywhere (`maxEmployees` is
"informational — never enforced" per the existing code comment). This feature needs the first real
gate. Implemented the same way `@Roles`/`RolesGuard` already gates OWNER/ADMIN actions:
- New `@RequirePlan(['BUSINESS','ENTERPRISE'])` decorator + `PlanGuard`, reading the caller's
  `companyId` off the already-verified JWT (same source `RolesGuard` uses), loading `Subscription.plan`,
  403 if not in the allowed list. No schema change — `Subscription.plan` already exists.
- Applied only to `POST /workflows/generate` for now. Written generically enough that a future feature
  could reuse `@RequirePlan(...)` on another endpoint without rework, but no other endpoint is touched
  by this spec — resist the urge to retrofit it everywhere today.

## Grounding: what the AI is allowed to see
Per the user's choice ("Option 1"), before calling the LLM the backend assembles real context for
*this company only*:
- Its installed skills (from the existing Skills catalog + `InstalledSkill` — same data the builder's
  tool picker already shows).
- Its hired AI employees (existing `AiEmployee` list).
- The existing node-type enum (TRIGGER/RETRIEVE/AI_STEP/TOOL_ACTION/WAIT/CONDITION/APPROVAL/NOTIFY) and
  the existing `WorkflowDefinitionDto` shape, given to the LLM as its exact output contract.
It is explicitly NOT given other companies' data, and it never suggests a skill the company hasn't
already installed — matching the "never suggest something they'd need to go set up first" refinement
from the brainstorm.

## Anti-hallucination / fallback strategy (this is the core safety mechanism)
Three layers, in order, and **nothing invalid is ever returned to the user, let alone saved**:

1. **Validate before showing anything.** After the LLM returns a draft, before the response even
   leaves the backend: (a) run it through the *existing* `WorkflowDefinitionDto` validation (structural
   correctness — valid node types, edges pointing at real node ids in the same graph — this validation
   already exists for manual creation, reused as-is); (b) a **new**, small check specific to this
   feature — every `TOOL_ACTION` node's skill/tool must exist in the real catalog **and** be installed
   for this company; every employee reference must be a real, currently-hired employee of this company.
2. **One self-correction attempt.** If step 1 finds a problem, don't show it to the user. Instead,
   call the LLM again, once, with the specific problem named ("`stripe.charge` isn't installed for this
   company — here is the exact list of installed skills: [...]. Fix just that step.").
3. **Graceful degrade, never a hard failure.** If the second attempt still has a problem, don't reject
   the whole draft and don't guess. Replace only the offending node's tool/employee reference with an
   explicit "unconfigured — choose one" placeholder, keep the rest of the draft as-is, and add that
   step's name to the `warnings` array in the response. The builder UI visibly flags that one step; the
   rest of the workflow is untouched. The user always gets *something* usable back.

Because nothing is persisted until the user clicks the existing Save button (see above), there is no
scenario in which a hallucinated reference ends up sitting in the `workflows` table — the worst case is
a draft with one step marked "needs your input," which is exactly the same state a human would be in
if they'd left a step unconfigured while building it by hand.

**Existing workflows are never touched.** Generation only ever produces a brand-new draft; it cannot
edit or overwrite an existing (possibly active/running) workflow. Regenerating or discarding a bad draft
has zero blast radius.

## Explicitly out of scope for this version
- Editing an *existing* workflow via AI (only net-new drafts).
- Auto-activating a generated workflow, or auto-configuring SCHEDULE/WEBHOOK/EVENT triggers (a
  generated draft defaults to `MANUAL` trigger, same as a freshly hand-built one; the user sets up a
  real trigger afterward through the existing Trigger panel).
- Persisting the chat/generation history anywhere.
- Any plan-gating beyond this one endpoint.

## Testing
- e2e: non-BUSINESS/ENTERPRISE company → `POST /workflows/generate` → 403 (`PlanGuard`).
- e2e: mock `LlmProvider` returns a definition referencing a skill the test company never installed →
  assert the response is `type:'draft'` with that one node placeholder'd and named in `warnings`,
  **not** an error, and assert no `Workflow` row was created by this call.
- e2e: mock provider's *first* response is invalid, *second* (post-correction) response is valid →
  assert the final response has no warnings and reflects the corrected draft.
- Uses the existing `LLM_PROVIDER=mock` deterministic-offline convention already used by every other
  e2e suite — no live API key needed for tests.
