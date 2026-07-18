# V-AEP Platform — Per-Employee Skill Connections (Design Spec)

**Date:** 2026-07-18 · **Status:** Approved · **Scope:** let a company connect the SAME skill type
(starting with Gmail) more than once, each connection owned by one specific AI Employee, and make sure
incoming events only trigger the workflows meant for that specific mailbox.

## Goal

Today a company can connect exactly **one** Gmail mailbox, shared company-wide — enforced by
`InstalledSkill`'s `@@unique([companyId, skillKey])`. A real company has multiple role-based mailboxes on
its own domain (`hr@company.com`, `support@company.com`, `sales@company.com`) and wants **each AI
Employee to own its own mailbox** — HR AI reads `hr@`, Support AI reads `support@` — without one
workflow accidentally firing off another mailbox's mail (e.g. a resume-screening workflow must never fire
because someone emailed `support@`).

**No special domain setup is needed for this** — `hr@company.com` is just a normal Google Workspace
mailbox; connecting it uses the exact same OAuth flow already built for any Gmail account, regardless of
domain. This spec is purely about letting **more than one** such connection exist per company, each tied
to the employee it belongs to, and making sure events route to the right place.

## Data model change

Add one nullable column to the existing `InstalledSkill` model — no new table:

```prisma
model InstalledSkill {
  // ...existing fields unchanged...
  employeeId String?    // null = company-wide (today's exact behavior, unchanged for every existing row).
                         // Set = this connection is owned by, and only by, that one AiEmployee.
  employee   AiEmployee? @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  @@unique([companyId, skillKey, employeeId])   // was [companyId, skillKey]
  @@index([employeeId])
}
```

- `employeeId = null` is **exactly today's behavior** — every existing row (including the live Kashif
  Recruiting tenant's current company-wide Gmail connection, if one exists) keeps working unchanged; nothing
  about this migration touches or reinterprets existing rows.
- `onDelete: Cascade` — deleting an AI Employee also removes its dedicated skill connections (a mailbox
  connection tied to a now-deleted employee has no owner and no reason to keep polling).
- Duplicate prevention (e.g. blocking a second company-wide Gmail, or the same employee connecting Gmail
  twice) stays an **application-level check** in `SkillsService.install()` — extending its existing
  pre-create existence check to match on `employeeId` too (`null` vs a specific employee), the same way
  it already blocks a duplicate company-wide install today. This avoids a Postgres partial-unique-index
  migration (Postgres treats `NULL` as distinct from `NULL` in a plain composite unique constraint, so the
  DB-level constraint alone can't block "two company-wide rows") — the risk profile (a rare race between
  the check and the create) is identical to what already exists today, just extended to the new column.

## Install flow: extend, don't replace

`POST /skills/install` (`InstallSkillDto`) gains one optional field: `employeeId?: string`.

- If provided, `SkillsService.install()` verifies that `AiEmployee` belongs to the caller's company (tenant
  check, same pattern used everywhere else in this codebase), then creates the `InstalledSkill` row with
  that `employeeId`, **and auto-creates the matching `EmployeeSkill` assignment row** in the same
  transaction — so the connection is immediately usable by that employee's chat tool-calling loop without
  a separate manual "assign" step. (Today, install and assign are two separate manual actions; that stays
  true for company-wide installs, but a per-employee install self-assigns since there's only one sensible
  owner.)
- If omitted, behavior is **byte-for-byte identical to today** — company-wide install, no auto-assignment.
- **The OAuth authorize/callback flow itself needs zero changes.** It already operates purely in terms of
  `installedSkillId` (looked up from the DB, `employeeId` is just a property on that row) — connecting a
  per-employee Gmail row calls the exact same `GET /skills/installed/:id/oauth/authorize` →
  provider consent → `GET /skills/oauth/callback` → `SkillsService.connectOAuth` sequence that already
  exists, unmodified.

## Routing: only the right workflow fires

Today, `WorkflowsService.fireEvent(companyId, eventType, payload)` matches every `ACTIVE` workflow in the
company whose `triggerConfig.eventType` matches — with no awareness of which connector produced the
event. If a company has 3 Gmail connectors, *any* Gmail-triggered workflow fires for *all 3* mailboxes
today, which is the actual bug behind "resume-screening firing because someone emailed support@".

Fix, entirely additive:
- `TriggerConfig` (shared type) gains an optional `connectorId?: string`.
- `fireEvent` gains an optional 4th parameter: `fireEvent(companyId, eventType, payload?, connectorId?)`.
  The existing in-process narrowing step (where `conditions` are already evaluated against candidate
  workflows) gets one more check alongside it: **skip a candidate workflow if its own
  `triggerConfig.connectorId` is set and doesn't match the incoming `connectorId`.** A workflow with no
  `connectorId` set keeps matching every connector of that event type — today's exact behavior, unchanged,
  so existing single-mailbox workflows are unaffected.
- The Gmail inbound driver already has the firing connector in scope as `connector.id` at its
  `fireEvent(...)` call site (it's already stored on the `CanonicalEvent` row as `connectorId` — "connector"
  in this codebase already just means "the `InstalledSkill` row that received this event," there is no
  separate `Connector` model) — it just isn't threaded through to `fireEvent` yet. One-line addition.
- No changes needed to the Gmail inbound poller's sweep loop at all — it already queries every `CONNECTED`
  Gmail `InstalledSkill` row company-agnostically and polls each independently (including its own
  `inboundCursor`, already a per-row field), so multiple connectors per company — some company-wide, some
  per-employee — are picked up with zero query changes.

## Frontend

1. **Employee page ("Tools" tab, `EmployeeSkillPicker`)**: today this only assigns/unassigns *already
   company-installed* skills. Add a new section: a short list of OAuth-capable skills (starting with
   Gmail) not yet connected *for this specific employee*, each with a "Connect for [Employee Name]"
   button. Clicking it calls `POST /skills/install` with `{skillKey, employeeId}`, then immediately renders
   the existing `ConnectSkillControl` for the newly-created row to complete the OAuth handshake — reusing
   that component exactly as-is, since it already works generically off any `InstalledSkill` id.
2. **Workflow trigger editor**: for an EVENT-type trigger, add an optional "Only for this connected
   mailbox" dropdown — populated from the company's connected Gmail `InstalledSkill` rows (both
   company-wide and per-employee) — defaulting to "Any" (`connectorId` unset, today's behavior). Selecting
   one sets `triggerConfig.connectorId`.
3. The existing global `/skills` catalog page and its company-wide "Connect Gmail" flow are **untouched**
   — a company that only wants one shared inbox keeps using it exactly as today.

## Explicitly out of scope for this version

- Any email provider other than Gmail (Microsoft 365/Outlook, IMAP, etc.) — separate future work.
- Real-time push (Gmail `watch()` + Pub/Sub) — the existing ~60s polling driver is unchanged.
- Revoking the OAuth grant with the provider when an employee (and its connection) is deleted — matches
  today's existing disconnect behavior, which also doesn't call the provider's revoke endpoint.
- Any change to how `read_inbox`/`send_email` tool-calling works during a chat — this spec is about
  *automated inbound event routing*, not the on-demand chat tools (`read_inbox` has no executor yet
  either way, a pre-existing gap unrelated to this change).

## Testing

- Unit: `SkillsService.install()` — company-wide install unaffected (no `employeeId`); per-employee install
  creates the row + auto-assigns; a duplicate per-employee install (same employee, same skillKey) is
  rejected; a duplicate company-wide install (two installs with no `employeeId`) is still rejected, same as
  today.
- Unit: `WorkflowsService.fireEvent()` — a workflow with no `connectorId` fires for any connector (today's
  behavior, regression check); a workflow with a `connectorId` only fires when the passed connector matches,
  and is skipped for a different connector's event.
- e2e: two Gmail connections for one company (one company-wide, one owned by an HR employee); an inbound
  email via the HR employee's connector fires only the HR-scoped workflow, not a company-wide-scoped one
  watching the same `eventType`, and vice versa.
