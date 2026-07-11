# Custom-role AI Employees — Edge Cases
**Covers:** MarketingAI, ProcurementAI, OperationsAI, LegalAI — all `role: CUSTOM` (Step-14
marketplace expansions). They share the generic AI Employee runtime; there's no dedicated backend
logic per template, only a distinct `persona` + `suggestedSkills`. Grouped in one file since the
same platform-level nuances apply to all four.

---

## Cross-cutting note: the role-scope guardrail for `CUSTOM`

`ROLE_SCOPE.CUSTOM = 'the tasks described in your persona below'` — unlike named roles
(RECRUITER/SALES/SUPPORT/HR/ACCOUNTANT/PROJECT_MANAGER), all four CUSTOM-role employees share
this identical, generic scope line; the actual boundary comes entirely from each one's distinct
`persona` text.

**CUSTOM-01 — Does the guardrail work without an explicit named category?**
**Steps:** ask LegalAI to "draft a marketing campaign," or ask MarketingAI to "review this
contract."
**Expected:** should still decline, AND name the correct sibling employee to redirect to.
**Status:** ✅ **Fixed** — the guardrail no longer relies solely on the 4 hardcoded example
categories generalizing by chance. `buildSystemPrompt` now queries the company's OTHER active
employees (name + role, and for CUSTOM roles a clipped persona snippet as the scope description)
and lists them by name in the system prompt: `"Other AI employees at this company — redirect
off-role requests to: - LegalAI (CUSTOM): reviews contracts..."`. Live-verified with real GPT: a
MarketingAI (CUSTOM) asked to review a contract replied *"...I recommend consulting...a
specialized legal AI assistant like LegalAI"* — correctly naming the actual hired sibling
employee, not a generic deflection.

---

## MarketingAI
**Persona:** drafts campaign copy, plans content calendars, summarizes research, proposes channel
strategy. **Skills:** email, slack, gdrive.

**MKT-01 — Drafting campaign copy** — ✅ **Handled** — pure generation grounded in the knowledge
base (brand voice docs); no special tool needed, works like any chat response.
**MKT-02 — "Save this campaign brief to Drive"** — ✅ **Fixed this session** — needs
`gdrive.upload_file` (already existed) to persist; reading it back later needs the newly-added
`read_file`/`list_files` (also fixed this session).
**MKT-03 — "What did we publish last month?" (needs a content calendar/history)** — ❌ **Gap** —
no dedicated content-calendar concept/tool exists; this would rely entirely on whatever's in the
knowledge base or Drive, with no structured "list past campaigns" capability.

---

## ProcurementAI
**Persona:** compares vendors, drafts RFQs, tracks purchase requests, summarizes contract terms.
**Skills:** email, gdrive, slack.

**PROC-01 — Drafting an RFQ email** — ✅ **Handled** — generation + `email.send_email`, both work.
**PROC-02 — "Summarize this vendor contract" (reads a Drive file)** — ✅ **Fixed this session** —
needs `gdrive.read_file` (previously didn't exist at all — this scenario was fully broken before
this session's fix).
**PROC-03 — "Track the status of purchase request #42"** — ❌ **Gap** — "tracks purchase requests"
implies some PERSISTENT state (a request id, its approval status, who requested it) — no such
concept/table exists anywhere in the platform; this is pure prompt promise with zero structural
backing. Would need a real feature (a PurchaseRequest model + workflow), not just a tool addition.
**PROC-04 — Comparing vendor quotes** — ⚠️ **Partial** — reasoning-only (LLM compares whatever
text it's given); no vendor-database/pricing-comparison tool exists.

---

## OperationsAI
**Persona:** monitors recurring processes, triages incoming requests, produces status reports,
flags bottlenecks. **Skills:** slack, jira, gdrive.

**OPS-01 — "What issues are still open in ENG?" (monitor processes)** — ✅ **Fixed this session**
— needs `jira.list_issues`/`get_issue` (same fix as PM-01/02, shared catalog).
**OPS-02 — "Triage this incoming request" (create + potentially transition a ticket)** — ✅
**Fixed this session** — `create_issue` already existed; `transition_issue` (new) lets it actually
move a triaged item through its lifecycle instead of only ever creating new ones.
**OPS-03 — "Produce a status report across all projects"** — ⚠️ **Partial** — `list_issues`
requires a single `project` key; there's no cross-project aggregation tool, so a true multi-project
report would need several sequential tool calls (bounded by `MAX_ACT_ITERATIONS = 3`) — a report
spanning 4+ projects could hit that bound (see workflow-engine-edge-cases SUP-05 for the same
class of limitation on the chat/runtime side).
**OPS-04 — Recurring/scheduled monitoring (not just on-demand chat)** — ❌ **Gap** — "monitors
recurring processes" implies something proactive/scheduled; an OperationsAI *employee* (chat-based)
has no schedule of its own — that requires wiring it into a workflow with a SCHEDULE trigger
(the WORKFLOW engine supports this already), which isn't set up by the marketplace install itself.

---

## LegalAI
**Persona:** reviews/summarizes contracts, extracts clauses and obligations, answers policy
questions; always disclaims "not legal advice." **Skills:** gdrive, email.

**LEGAL-01 — "Extract the termination clause from this contract"** — ✅ **Fixed this session,
was CRITICAL** — this was the single most broken promise in the whole catalog: `gdrive` had
**only** `upload_file` before this session — LegalAI's entire headline capability ("extracts
clauses") had **zero** way to read ANY document's content. Now `gdrive.read_file` exists.
**LEGAL-02 — Does it actually add the "not legal advice" disclaimer?** — 🧪 **Untested** — this
is pure persona text (`persona: '...Always add the disclaimer...'`), not a platform-enforced rule
— unlike the role-scope guardrail (which IS platform-enforced), there's no structural check that
the disclaimer is actually present in every LegalAI response.
**LEGAL-03 — Contract stored as a scanned/image PDF** — ❌ **Gap (shared with REC-11)** — no OCR
anywhere in the platform; a scanned contract's text is unreadable regardless of which skill
reads it.
**LEGAL-04 — Contract in a non-Drive location (email attachment, not uploaded to Drive first)**
— ⚠️ **Partial** — LegalAI itself has no email-attachment-reading tool (only `email.send_email`)
— a contract would need to already be in Drive (or described in chat text) for `read_file` to work.
