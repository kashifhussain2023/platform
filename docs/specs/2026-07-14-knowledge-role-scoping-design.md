# V-AEP Platform — Role-Scoped Knowledge Base (Design Spec)

**Date:** 2026-07-14 · **Status:** Approved · **Scope:** extend the existing `modules/knowledge` slice with
a `category` axis, and surface a filtered view of it inside each AI Employee's own page.

## Goal
Today every document uploaded to a company goes into one shared pool — every AI employee (Sales, HR,
Recruiter, etc.) retrieves from the exact same set of chunks. This means a Sales AI can surface HR/payroll
documents in its answers, and vice versa. Scope knowledge by category so each employee's *role* only sees
its own category's documents plus explicitly-shared, company-wide ones.

## Data model (small, additive schema change)
Add one nullable column, reusing the existing `EmployeeRole` enum rather than inventing a new one:

```prisma
model KnowledgeDocument {
  // ...existing fields unchanged...
  category EmployeeRole?   // null = Shared/company-wide (visible to every role)
}

model KnowledgeChunk {
  // ...existing fields unchanged...
  category EmployeeRole?   // denormalized copy of the parent document's category,
                           // written at ingest time and kept in sync on retag —
                           // needed because the retrieval query filters chunks
                           // directly via raw SQL, not through a document join.
}
```

- `category = NULL` means **Shared** — visible to every role. This is also what every existing document
  becomes after migration (matches the decision to leave pre-existing docs untouched until manually
  re-tagged, rather than guessing their category).
- No new enum, no new table. `EmployeeRole` (`SUPPORT | SALES | RECRUITER | HR | ACCOUNTANT |
  PROJECT_MANAGER | CUSTOM`) already exists on `AiEmployee.role`; a document tagged `SALES` is visible to
  every `SALES`-role employee (category is role-wide, not tied to one specific employee instance — two
  Sales employees share the same Sales knowledge, per the chosen scoping level).
- Per this repo's pgvector gotcha (`CLAUDE.md`): author the migration with `prisma:migrate:new`, then
  before applying, check the generated SQL for a stray `DROP INDEX ..._embedding_idx` line on
  `KnowledgeChunk` and remove it if present (adding an unrelated column shouldn't trigger this, but the
  table is touched, so verify).

## Retrieval filtering
`KnowledgeService.search()`'s raw SQL gets one optional additional predicate:

```sql
WHERE "companyId" = ${companyId} AND embedding IS NOT NULL
  AND (${category}::text IS NULL OR "category" = ${category} OR "category" IS NULL)
```

- When no `category` is passed, behavior is **byte-for-byte unchanged** — every existing caller that
  doesn't opt in keeps seeing the full company pool.
- `RetrievalService.retrieve()` (the AI-employee chat runtime, `agent-runtime.service.ts`) is the only
  caller that opts in — it already has `employee.role` in scope at its call site and threads it through as
  the new `category` argument.
- **The workflow `RETRIEVE` node is explicitly left unfiltered.** It isn't attached to any one employee's
  role — it's a generic company-wide search step — so scoping it isn't well-defined and is out of scope for
  this change (no behavior change there).

## Ingest & retag
- `IngestionProcessor` already fetches the parent `KnowledgeDocument` row before inserting chunks; it now
  also copies `doc.category` into each chunk's raw `INSERT`.
- New `KnowledgeService.updateCategory(companyId, id, category: EmployeeRole | null)` — updates the
  document's `category` **and** cascades the same value to all of that document's existing chunks (a
  plain `updateMany`, not a vector operation, so ordinary Prisma is fine here) so retrieval never reads a
  stale chunk-level category after a retag.
- New endpoint: `PATCH /knowledge/documents/:id/category` — body `{ category: EmployeeRole | null }`.

## API surface changes (existing `KnowledgeController`, no new module)
- `POST /knowledge/documents` — accepts an optional `category` form field alongside `file`.
- `GET /knowledge/documents?category=SALES` — optional query param; omitted = all documents (used by the
  global page), present = that role's documents **plus** Shared ones (used by an employee's tab).
- `PATCH /knowledge/documents/:id/category` — new, see above.
- `POST /knowledge/search` — `SearchDto`/`SearchQueryDto` gains an optional `category` field, same
  omitted-means-unfiltered rule.

## UI: where knowledge is managed
Two entry points, same underlying components, different filtering — not two separate implementations:

1. **Global `/knowledge` page (kept, but removed from the main sidebar nav).** Still shows *every*
   document regardless of category, and is where the category dropdown for retagging naturally lives —
   retagging the 8 pre-existing documents is far easier from one list than by checking every employee's
   tab. Reachable by direct link even though it's no longer in the sidebar.
2. **New "Knowledge" tab on each AI Employee's detail page** (`employees/[id]/page.tsx`, alongside the
   existing Overview/Chat/Memory/Tools/Settings tabs — same tab-button pattern already used there). Shows
   only that employee's role's documents + Shared ones. Uploading from here defaults the new document's
   category to the employee's own role (with a toggle to mark it Shared instead), so day-to-day uploads
   need no manual tagging step.

`DocumentList`/`UploadPanel` (both already used by the global page) are extended with optional
props — a `category` filter and a `defaultCategory` for upload — rather than forked into new
components, so both entry points share one implementation.

The Sidebar's `/knowledge` nav entry is removed; the route/page itself is not deleted.

## Out of scope for this version
- Per-individual-employee knowledge (only role-level categories, per the chosen scoping level).
- Changing the workflow `RETRIEVE` node's filtering behavior.
- A dedicated "manage Shared documents" screen — Shared documents are visible (and taggable back to
  Shared) from both the global page and any employee's tab; no separate UI is needed.
- Migrating/auto-guessing categories for the 8 existing documents — they land as Shared (`category =
  NULL`) and are re-tagged manually via the existing global page's new dropdown.

## Testing
- Unit: `KnowledgeService.search()` — with a `category` filter, only matching-or-null-category chunks are
  returned; without one, behavior matches today's tests exactly (regression check).
- Unit: `updateCategory()` cascades to a document's existing chunks.
- Unit: `RetrievalService.retrieve()` passes the employee's role through to `knowledge.retrieve()`.
- e2e: upload a document tagged `SALES`, one tagged `HR`, one left Shared; assert a `SALES`-role
  employee's chat retrieval surfaces the `SALES` + Shared documents but never the `HR` one.
- e2e: `PATCH /knowledge/documents/:id/category` changes future retrieval visibility for that document.
