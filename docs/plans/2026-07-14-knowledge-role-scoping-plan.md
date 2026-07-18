# Role-Scoped Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the existing company-wide Knowledge Base by AI-employee role (Sales/HR/Recruiter/etc.),
so each employee only retrieves its own role's documents plus explicitly-Shared ones, and surface a
filtered view of it inside each AI Employee's own page.

**Architecture:** Add one nullable `category` column (reusing the existing `EmployeeRole` enum) to
`KnowledgeDocument` and its denormalized copy on `KnowledgeChunk`. Thread an optional `category` filter
through the existing search/retrieve path (`category = null` always matches — that's "Shared"). Every
caller that doesn't pass a category keeps today's exact behavior. No new module, no new table.

**Tech Stack:** NestJS + Prisma + Postgres/pgvector (backend), Next.js + TanStack Query (frontend), the
existing `@vaep/types` shared package.

## Global Constraints

- Reuse the existing `EmployeeRole` enum (`SUPPORT | SALES | RECRUITER | HR | ACCOUNTANT |
  PROJECT_MANAGER | CUSTOM`) as the category type. No new enum, no new table, no new module.
- `category = null` means **Shared/company-wide** — visible to every role. Every pre-existing document
  must land here untouched after migration; nothing auto-guesses a category for them.
- Every existing caller of `KnowledgeService.list/search/retrieve` that does not pass a `category` must
  see **byte-for-byte unchanged behavior** — the filter is additive-only.
- The workflow `RETRIEVE` node's behavior does **not** change in this plan — it stays company-wide,
  unfiltered. Do not touch `workflow-engine.service.ts`.
- Per `platform/CLAUDE.md`'s pgvector gotcha: author the migration with `prisma:migrate:new`, then check
  the generated SQL for a stray `DROP INDEX ..._embedding_idx` line on `KnowledgeChunk` before it's
  applied, and remove it if present.
- The global `/knowledge` page is **not deleted** — only its Sidebar nav entry is removed. `DocumentList`
  and `UploadPanel` are extended with optional props (category filter / default category), not forked
  into new components — both the global page and the new per-employee tab render the same components.
- Scoping is per-**role**, not per-individual-employee: all employees sharing a role see the same
  category's documents.

---

### Task 1: Prisma schema + migration for the `category` column

**Files:**
- Modify: `apps/api/prisma/schema.prisma:202-231` (`KnowledgeDocument`, `KnowledgeChunk` models)
- Create: `apps/api/prisma/migrations/<timestamp>_add_knowledge_category/migration.sql` (generated, then verified)

**Interfaces:**
- Produces: `KnowledgeDocument.category: EmployeeRole | null`, `KnowledgeChunk.category: EmployeeRole | null` — every later task in this plan reads/writes these two columns.

- [ ] **Step 1: Add the `category` field to both models**

In `apps/api/prisma/schema.prisma`, change:

```prisma
model KnowledgeDocument {
  id         String           @id @default(cuid())
  companyId  String
  company    Company          @relation(fields: [companyId], references: [id], onDelete: Cascade)
  filename   String
  mimeType   String
  sizeBytes  Int
  storageKey String
  status     DocumentStatus   @default(PENDING)
  error      String?
  chunkCount Int              @default(0)
  createdAt  DateTime         @default(now())

  chunks KnowledgeChunk[]

  @@index([companyId])
}

model KnowledgeChunk {
  id         String                       @id @default(cuid())
  documentId String
  document   KnowledgeDocument            @relation(fields: [documentId], references: [id], onDelete: Cascade)
  companyId  String
  content    String
  chunkIndex Int
  embedding  Unsupported("vector(384)")?
  createdAt  DateTime                     @default(now())

  @@index([companyId])
}
```

to:

```prisma
model KnowledgeDocument {
  id         String           @id @default(cuid())
  companyId  String
  company    Company          @relation(fields: [companyId], references: [id], onDelete: Cascade)
  filename   String
  mimeType   String
  sizeBytes  Int
  storageKey String
  status     DocumentStatus   @default(PENDING)
  error      String?
  chunkCount Int              @default(0)
  // null = Shared/company-wide (visible to every AI-employee role). Non-null
  // scopes the document to that one role's retrieval (docs/specs/2026-07-14-
  // knowledge-role-scoping-design.md).
  category   EmployeeRole?
  createdAt  DateTime         @default(now())

  chunks KnowledgeChunk[]

  @@index([companyId])
}

model KnowledgeChunk {
  id         String                       @id @default(cuid())
  documentId String
  document   KnowledgeDocument            @relation(fields: [documentId], references: [id], onDelete: Cascade)
  companyId  String
  content    String
  chunkIndex Int
  embedding  Unsupported("vector(384)")?
  // Denormalized copy of the parent document's category, written at ingest
  // time (ingestion.processor.ts) and kept in sync on retag
  // (KnowledgeService.updateCategory) — needed because the pgvector search
  // filters chunks directly via raw SQL, not through a document join.
  category   EmployeeRole?
  createdAt  DateTime                     @default(now())

  @@index([companyId])
}
```

- [ ] **Step 2: Generate the migration**

Run from `apps/api`:

```bash
pnpm run prisma:migrate:new -- --name add_knowledge_category
```

This both writes a new `prisma/migrations/<timestamp>_add_knowledge_category/migration.sql` and applies
it to your local dev database.

- [ ] **Step 3: Verify the generated SQL — no destructive index drop**

Open the generated `migration.sql`. Per the pgvector gotcha in `platform/CLAUDE.md`, Prisma's schema
can't represent the HNSW index on `KnowledgeChunk.embedding`, so a `migrate dev` diff on a table with
that column can wrongly propose `DROP INDEX "KnowledgeChunk_embedding_idx";`. The file must contain
**only** these two statements (order may differ):

```sql
ALTER TABLE "KnowledgeDocument" ADD COLUMN "category" "EmployeeRole";
ALTER TABLE "KnowledgeChunk" ADD COLUMN "category" "EmployeeRole";
```

If the generated file contains a `DROP INDEX ..._embedding_idx` line, delete that line (and, if present,
a matching stray `CREATE INDEX` that doesn't say `USING hnsw`), leaving only the two `ADD COLUMN`
statements above. Do not re-run `migrate dev` after hand-editing — the migration is already applied from
Step 2; editing the file only fixes what gets committed and re-applied elsewhere.

- [ ] **Step 4: Regenerate the Prisma client and typecheck**

```bash
pnpm --filter @vaep/api run prisma:generate
pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json
```

Expected: the typecheck fails with errors about `category` being used before it exists elsewhere in the
codebase — that's expected until later tasks add those usages. Confirm specifically that there are **no**
errors from `schema.prisma`/Prisma client generation itself (i.e. `prisma generate` succeeds and the
`PrismaClient` types now include `category` on both models — you can spot-check this via `grep category
node_modules/.prisma/client/index.d.ts` from `apps/api`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat: add category column to KnowledgeDocument/KnowledgeChunk"
```

---

### Task 2: Shared types for the category field

**Files:**
- Modify: `packages/types/src/index.ts` (`KnowledgeDocumentDto`, `searchSchema`, new `UpdateDocumentCategoryDto`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `KnowledgeDocumentDto.category: EmployeeRole | null`, `SearchQueryDto.category?: EmployeeRole`, `UpdateDocumentCategoryDto { category: EmployeeRole | null }` — every backend/frontend task after this one uses these.

- [ ] **Step 1: Add `category` to `KnowledgeDocumentDto`**

In `packages/types/src/index.ts`, change:

```typescript
/** Public shape of a knowledge document (never includes the storage key). */
export interface KnowledgeDocumentDto {
  id: string;
  companyId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
}
```

to:

```typescript
/** Public shape of a knowledge document (never includes the storage key). */
export interface KnowledgeDocumentDto {
  id: string;
  companyId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
  /** null = Shared/company-wide; otherwise scoped to that AI-employee role. */
  category: EmployeeRole | null;
}
```

(`EmployeeRole` is declared later in this same file — a type-only forward reference like this is fine in
TypeScript; only `const` *values* referenced before their declaration would fail.)

- [ ] **Step 2: Add `category` to the search schema**

In the same file, change:

```typescript
/** Knowledge search form/body contract — web uses this directly (rhf + zod). */
export const searchSchema = z.object({
  query: z.string().min(1, 'Enter a search query').max(1000),
  k: z.number().int().min(1).max(50).optional(),
});
```

to:

```typescript
/** Knowledge search form/body contract — web uses this directly (rhf + zod). */
export const searchSchema = z.object({
  query: z.string().min(1, 'Enter a search query').max(1000),
  k: z.number().int().min(1).max(50).optional(),
  // Hardcoded (not EMPLOYEE_ROLES) because EMPLOYEE_ROLES is declared later in
  // this file as a `const` — referencing it here would hit the temporal dead
  // zone at module-eval time. Keep in sync with EMPLOYEE_ROLES below.
  category: z
    .enum(['SUPPORT', 'SALES', 'RECRUITER', 'HR', 'ACCOUNTANT', 'PROJECT_MANAGER', 'CUSTOM'])
    .optional(),
});
```

- [ ] **Step 3: Add `UpdateDocumentCategoryDto`**

Immediately after the `KnowledgeDocumentDto` interface (before `SearchQueryDto`), add:

```typescript
/** PATCH /knowledge/documents/:id/category body. `category: null` = Shared/company-wide. */
export interface UpdateDocumentCategoryDto {
  category: EmployeeRole | null;
}
```

- [ ] **Step 4: Build the package and typecheck**

```bash
pnpm --filter @vaep/types build
pnpm --filter @vaep/types exec tsc --noEmit
```

Expected: both succeed with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat: add category to KnowledgeDocumentDto and search/update contracts"
```

Before staging, run `git diff packages/types/src/index.ts` and confirm the diff contains **only** the
three additions above — this file has a known history of unrelated pre-existing dirty content in past
sessions ([[git-add-file-sweeps-whole-diff]] memory); if you see unrelated changes already sitting in
this file, stop and flag it rather than committing them.

---

### Task 3: `KnowledgeService` category-aware upload/list/search + `updateCategory`

**Files:**
- Modify: `apps/api/src/modules/knowledge/knowledge.service.ts`
- Modify: `apps/api/src/modules/knowledge/dto/search.dto.ts`
- Create: `apps/api/src/modules/knowledge/knowledge.service.spec.ts`

**Interfaces:**
- Consumes: `EmployeeRole`/`EMPLOYEE_ROLES` from `@vaep/types` (Task 2), `category` columns (Task 1).
- Produces: `KnowledgeService.upload(companyId, file, category?)`, `.list(companyId, category?)`,
  `.search(companyId, dto)` (dto now carries optional `category`), `.retrieve(companyId, query, k, category?)`,
  and new `.updateCategory(companyId, id, category): Promise<KnowledgeDocumentDto>` — Tasks 4, 5, 6 call these.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/api/src/modules/knowledge/knowledge.service.spec.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

function fakePrisma() {
  return {
    knowledgeDocument: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    knowledgeChunk: {
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

function fakeStorage() {
  return { put: jest.fn(), get: jest.fn(), delete: jest.fn() };
}

function fakeEmbeddings() {
  return { embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]) };
}

function fakeQueue() {
  return { add: jest.fn() };
}

describe('KnowledgeService category scoping', () => {
  it('list() without a category returns the plain companyId filter (unchanged behavior)', async () => {
    const prisma = fakePrisma();
    const service = new KnowledgeService(
      prisma as never,
      fakeStorage() as never,
      fakeEmbeddings() as never,
      fakeQueue() as never,
    );

    await service.list('co_1');

    expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith({
      where: { companyId: 'co_1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('list() with a category filters to that category OR Shared (null)', async () => {
    const prisma = fakePrisma();
    const service = new KnowledgeService(
      prisma as never,
      fakeStorage() as never,
      fakeEmbeddings() as never,
      fakeQueue() as never,
    );

    await service.list('co_1', 'SALES');

    expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith({
      where: { companyId: 'co_1', OR: [{ category: 'SALES' }, { category: null }] },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('search() without a category issues no category predicate (unchanged behavior)', async () => {
    const prisma = fakePrisma();
    const service = new KnowledgeService(
      prisma as never,
      fakeStorage() as never,
      fakeEmbeddings() as never,
      fakeQueue() as never,
    );

    await service.search('co_1', { query: 'refund policy' });

    const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).not.toContain('category');
  });

  it('search() with a category adds the category-OR-Shared predicate', async () => {
    const prisma = fakePrisma();
    const service = new KnowledgeService(
      prisma as never,
      fakeStorage() as never,
      fakeEmbeddings() as never,
      fakeQueue() as never,
    );

    await service.search('co_1', { query: 'refund policy', category: 'SALES' });

    const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('"category" = ');
    expect(sql.sql).toContain('"category" IS NULL');
    expect(sql.values).toContain('SALES');
  });

  it('updateCategory() updates the document and cascades to all its chunks', async () => {
    const prisma = fakePrisma();
    prisma.knowledgeDocument.findFirst.mockResolvedValue({ id: 'doc_1', companyId: 'co_1' });
    prisma.knowledgeDocument.update.mockResolvedValue({
      id: 'doc_1',
      companyId: 'co_1',
      filename: 'a.txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
      storageKey: 'k',
      status: 'READY',
      error: null,
      chunkCount: 1,
      category: 'HR',
      createdAt: new Date(),
    });
    const service = new KnowledgeService(
      prisma as never,
      fakeStorage() as never,
      fakeEmbeddings() as never,
      fakeQueue() as never,
    );

    const result = await service.updateCategory('co_1', 'doc_1', 'HR');

    expect(prisma.knowledgeDocument.update).toHaveBeenCalledWith({
      where: { id: 'doc_1' },
      data: { category: 'HR' },
    });
    expect(prisma.knowledgeChunk.updateMany).toHaveBeenCalledWith({
      where: { documentId: 'doc_1' },
      data: { category: 'HR' },
    });
    expect(result.category).toBe('HR');
  });

  it('updateCategory() accepts null to move a document back to Shared', async () => {
    const prisma = fakePrisma();
    prisma.knowledgeDocument.findFirst.mockResolvedValue({ id: 'doc_1', companyId: 'co_1' });
    prisma.knowledgeDocument.update.mockResolvedValue({
      id: 'doc_1',
      companyId: 'co_1',
      filename: 'a.txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
      storageKey: 'k',
      status: 'READY',
      error: null,
      chunkCount: 1,
      category: null,
      createdAt: new Date(),
    });
    const service = new KnowledgeService(
      prisma as never,
      fakeStorage() as never,
      fakeEmbeddings() as never,
      fakeQueue() as never,
    );

    const result = await service.updateCategory('co_1', 'doc_1', null);

    expect(prisma.knowledgeChunk.updateMany).toHaveBeenCalledWith({
      where: { documentId: 'doc_1' },
      data: { category: null },
    });
    expect(result.category).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run from `apps/api`: `npx jest --config ./test/jest-unit.json knowledge.service.spec.ts`
Expected: FAIL — `service.list`/`service.search`/`service.updateCategory` don't yet accept/return a
`category`, and `updateCategory` doesn't exist yet.

- [ ] **Step 3: Update `SearchDto`**

Replace the full contents of `apps/api/src/modules/knowledge/dto/search.dto.ts` with:

```typescript
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { EMPLOYEE_ROLES, type EmployeeRole, type SearchQueryDto } from '@vaep/types';

/** POST /knowledge/search body. Mirrors the shared @vaep/types contract. */
export class SearchDto implements SearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  k?: number;

  @IsOptional()
  @IsIn(EMPLOYEE_ROLES)
  category?: EmployeeRole;
}
```

- [ ] **Step 4: Implement the service changes**

In `apps/api/src/modules/knowledge/knowledge.service.ts`:

Change the import line:
```typescript
import type { KnowledgeDocument } from '@prisma/client';
```
to:
```typescript
import { Prisma, type KnowledgeDocument } from '@prisma/client';
```

Add to the `@vaep/types` import:
```typescript
import type { KnowledgeDocumentDto, SearchResultDto } from '@vaep/types';
```
becomes:
```typescript
import type { EmployeeRole, KnowledgeDocumentDto, SearchResultDto } from '@vaep/types';
```

Replace `upload()`:
```typescript
  async upload(
    companyId: string,
    file: UploadedDocFile | undefined,
  ): Promise<KnowledgeDocumentDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const storageKey = `${companyId}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        companyId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        status: 'PENDING',
      },
    });
```
with:
```typescript
  async upload(
    companyId: string,
    file: UploadedDocFile | undefined,
    category?: EmployeeRole,
  ): Promise<KnowledgeDocumentDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const storageKey = `${companyId}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        companyId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        status: 'PENDING',
        category: category ?? null,
      },
    });
```

Replace `list()`:
```typescript
  async list(companyId: string): Promise<KnowledgeDocumentDto[]> {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map(toDocumentDto);
  }
```
with:
```typescript
  async list(companyId: string, category?: EmployeeRole): Promise<KnowledgeDocumentDto[]> {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: category
        ? { companyId, OR: [{ category }, { category: null }] }
        : { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map(toDocumentDto);
  }
```

Replace `retrieve()`:
```typescript
  retrieve(
    companyId: string,
    query: string,
    k = 5,
  ): Promise<SearchResultDto[]> {
    return this.search(companyId, { query, k });
  }
```
with:
```typescript
  retrieve(
    companyId: string,
    query: string,
    k = 5,
    category?: EmployeeRole,
  ): Promise<SearchResultDto[]> {
    return this.search(companyId, { query, k, category });
  }
```

Replace `search()`:
```typescript
  async search(companyId: string, dto: SearchDto): Promise<SearchResultDto[]> {
    const k = dto.k ?? 5;
    const [vector] = await this.embeddings.embed([dto.query]);
    const literal = toVectorLiteral(vector);

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; documentId: string; content: string; score: number }>
    >`
      SELECT "id", "documentId", "content", 1 - (embedding <=> ${literal}::vector) AS score
      FROM "KnowledgeChunk"
      WHERE "companyId" = ${companyId} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${k}
    `;

    return rows.map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      content: r.content,
      score: Number(r.score),
    }));
  }
```
with:
```typescript
  async search(companyId: string, dto: SearchDto): Promise<SearchResultDto[]> {
    const k = dto.k ?? 5;
    const [vector] = await this.embeddings.embed([dto.query]);
    const literal = toVectorLiteral(vector);
    const categoryFilter = dto.category
      ? Prisma.sql`AND ("category" = ${dto.category}::"EmployeeRole" OR "category" IS NULL)`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; documentId: string; content: string; score: number }>
    >(Prisma.sql`
      SELECT "id", "documentId", "content", 1 - (embedding <=> ${literal}::vector) AS score
      FROM "KnowledgeChunk"
      WHERE "companyId" = ${companyId} AND embedding IS NOT NULL
      ${categoryFilter}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${k}
    `);

    return rows.map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      content: r.content,
      score: Number(r.score),
    }));
  }
```

Add a new `updateCategory()` method immediately after `remove()`:
```typescript
  /** Retags a document's category and cascades the change to its existing chunks (Task: role-scoping). */
  async updateCategory(
    companyId: string,
    id: string,
    category: EmployeeRole | null,
  ): Promise<KnowledgeDocumentDto> {
    const doc = await this.findOwned(companyId, id);
    const updated = await this.prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { category },
    });
    await this.prisma.knowledgeChunk.updateMany({
      where: { documentId: doc.id },
      data: { category },
    });
    return toDocumentDto(updated);
  }
```

Finally, update `toDocumentDto()`:
```typescript
function toDocumentDto(doc: KnowledgeDocument): KnowledgeDocumentDto {
  return {
    id: doc.id,
    companyId: doc.companyId,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    status: doc.status,
    error: doc.error,
    chunkCount: doc.chunkCount,
    createdAt: doc.createdAt.toISOString(),
  };
}
```
to:
```typescript
function toDocumentDto(doc: KnowledgeDocument): KnowledgeDocumentDto {
  return {
    id: doc.id,
    companyId: doc.companyId,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    status: doc.status,
    error: doc.error,
    chunkCount: doc.chunkCount,
    createdAt: doc.createdAt.toISOString(),
    category: doc.category,
  };
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run from `apps/api`: `npx jest --config ./test/jest-unit.json knowledge.service.spec.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json
```

Expected: still fails on `ingestion.processor.ts`/`knowledge.controller.ts` (not yet updated — Tasks 4-5)
but no longer on `knowledge.service.ts`/`search.dto.ts` themselves.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/knowledge/knowledge.service.ts apps/api/src/modules/knowledge/knowledge.service.spec.ts apps/api/src/modules/knowledge/dto/search.dto.ts
git commit -m "feat: category-aware KnowledgeService (list/search/retrieve/updateCategory)"
```

---

### Task 4: Ingestion writes the category onto each chunk

**Files:**
- Modify: `apps/api/src/modules/knowledge/ingestion/ingestion.processor.ts:77-80`

**Interfaces:**
- Consumes: `doc.category` (Task 1's schema change — the processor already fetches the full `doc` row).

- [ ] **Step 1: Add the column to the raw insert**

In `apps/api/src/modules/knowledge/ingestion/ingestion.processor.ts`, change:

```typescript
          await this.prisma.$executeRaw`
            INSERT INTO "KnowledgeChunk" ("id", "documentId", "companyId", "content", "chunkIndex", "embedding", "createdAt")
            VALUES (${randomUUID()}, ${documentId}, ${doc.companyId}, ${batch[j]}, ${inserted}, ${literal}::vector, now())
          `;
```

to:

```typescript
          await this.prisma.$executeRaw`
            INSERT INTO "KnowledgeChunk" ("id", "documentId", "companyId", "content", "chunkIndex", "embedding", "category", "createdAt")
            VALUES (${randomUUID()}, ${documentId}, ${doc.companyId}, ${batch[j]}, ${inserted}, ${literal}::vector, ${doc.category}::"EmployeeRole", now())
          `;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json
```

Expected: no new errors from this file (`doc.category` now exists on the Prisma-generated type from
Task 1).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/knowledge/ingestion/ingestion.processor.ts
git commit -m "feat: denormalize a document's category onto its ingested chunks"
```

---

### Task 5: Controller — category on upload/list + new retag endpoint

**Files:**
- Create: `apps/api/src/modules/knowledge/dto/upload-document.dto.ts`
- Create: `apps/api/src/modules/knowledge/dto/list-documents-query.dto.ts`
- Create: `apps/api/src/modules/knowledge/dto/update-document-category.dto.ts`
- Modify: `apps/api/src/modules/knowledge/knowledge.controller.ts`
- Modify: `apps/api/test/knowledge.e2e-spec.ts`

**Interfaces:**
- Consumes: `KnowledgeService.upload/list/updateCategory` (Task 3).
- Produces: `GET /knowledge/documents?category=`, `PATCH /knowledge/documents/:id/category` — the
  frontend (Task 7) calls these.

- [ ] **Step 1: Create the three small DTOs**

`apps/api/src/modules/knowledge/dto/upload-document.dto.ts`:
```typescript
import { IsIn, IsOptional } from 'class-validator';
import { EMPLOYEE_ROLES, type EmployeeRole } from '@vaep/types';

/** POST /knowledge/documents multipart body (alongside the `file` field). */
export class UploadDocumentDto {
  @IsOptional()
  @IsIn(EMPLOYEE_ROLES)
  category?: EmployeeRole;
}
```

`apps/api/src/modules/knowledge/dto/list-documents-query.dto.ts`:
```typescript
import { IsIn, IsOptional } from 'class-validator';
import { EMPLOYEE_ROLES, type EmployeeRole } from '@vaep/types';

/** GET /knowledge/documents?category=... query params. */
export class ListDocumentsQueryDto {
  @IsOptional()
  @IsIn(EMPLOYEE_ROLES)
  category?: EmployeeRole;
}
```

`apps/api/src/modules/knowledge/dto/update-document-category.dto.ts`:
```typescript
import { IsIn, ValidateIf } from 'class-validator';
import { EMPLOYEE_ROLES, type EmployeeRole } from '@vaep/types';

/** PATCH /knowledge/documents/:id/category body. `category: null` = Shared/company-wide. */
export class UpdateDocumentCategoryDto {
  @ValidateIf((_dto: UpdateDocumentCategoryDto, value: unknown) => value !== null)
  @IsIn(EMPLOYEE_ROLES)
  category!: EmployeeRole | null;
}
```

- [ ] **Step 2: Wire the controller**

Replace the full contents of `apps/api/src/modules/knowledge/knowledge.controller.ts` with:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { KnowledgeDocumentDto, SearchResultDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { SearchDto } from './dto/search.dto';
import { UpdateDocumentCategoryDto } from './dto/update-document-category.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { KnowledgeService, type UploadedDocFile } from './knowledge.service';

/** All routes are tenant-scoped by companyId from the JWT and JWT-guarded. */
@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** Upload a document (multipart field `file`, buffered in memory by Multer). */
  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentTenant() companyId: string,
    @UploadedFile() file: UploadedDocFile,
    @Body() dto: UploadDocumentDto,
  ): Promise<KnowledgeDocumentDto> {
    return this.knowledge.upload(companyId, file, dto.category);
  }

  @Get('documents')
  list(
    @CurrentTenant() companyId: string,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<KnowledgeDocumentDto[]> {
    return this.knowledge.list(companyId, query.category);
  }

  @Get('documents/:id')
  get(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<KnowledgeDocumentDto> {
    return this.knowledge.get(companyId, id);
  }

  /** Raw file bytes (inline disposition) for a "View" button / opening in a new tab. */
  @Get('documents/:id/content')
  async content(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, mimeType, filename } = await this.knowledge.getContent(
      companyId,
      id,
    );
    res.set({
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
    });
    return new StreamableFile(buffer);
  }

  @Patch('documents/:id/category')
  updateCategory(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentCategoryDto,
  ): Promise<KnowledgeDocumentDto> {
    return this.knowledge.updateCategory(companyId, id, dto.category);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  remove(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.knowledge.remove(companyId, id);
  }

  @Post('search')
  search(
    @CurrentTenant() companyId: string,
    @Body() dto: SearchDto,
  ): Promise<SearchResultDto[]> {
    return this.knowledge.search(companyId, dto);
  }
}
```

- [ ] **Step 3: Add e2e coverage**

In `apps/api/test/knowledge.e2e-spec.ts`, add these two tests at the end, immediately before the closing
`});` of the `describeIfDb` block (after the existing `'rejects knowledge routes without a token'` test):

```typescript
  it('uploads a document tagged with a category, and it is included when listing that category', async () => {
    const res = await request(app.getHttpServer())
      .post('/knowledge/documents')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('category', 'SALES')
      .attach('file', Buffer.from('Sales playbook content.', 'utf8'), {
        filename: 'sales-playbook.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    expect(res.body.category).toBe('SALES');

    const listed = await request(app.getHttpServer())
      .get('/knowledge/documents?category=SALES')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listed.body.some((d: { id: string }) => d.id === res.body.id)).toBe(true);

    const listedHr = await request(app.getHttpServer())
      .get('/knowledge/documents?category=HR')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listedHr.body.some((d: { id: string }) => d.id === res.body.id)).toBe(false);
  });

  it('retags a document via PATCH .../category, moving it between categories', async () => {
    const updated = await request(app.getHttpServer())
      .patch(`/knowledge/documents/${documentId}/category`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ category: 'HR' })
      .expect(200);
    expect(updated.body.category).toBe('HR');

    const backToShared = await request(app.getHttpServer())
      .patch(`/knowledge/documents/${documentId}/category`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ category: null })
      .expect(200);
    expect(backToShared.body.category).toBeNull();
  });
```

- [ ] **Step 4: Run the e2e test**

Run from `apps/api` (requires the local Postgres+Redis stack, see `platform/CLAUDE.md`):
```bash
DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public REDIS_URL=redis://127.0.0.1:6380 \
EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local JWT_ACCESS_SECRET=test JWT_REFRESH_SECRET=test \
npx jest --config ./test/jest-e2e.json knowledge.e2e-spec.ts
```
Expected: PASS, all tests including the 2 new ones.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json
```
Expected: no errors from the `knowledge` module.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/knowledge/dto/upload-document.dto.ts apps/api/src/modules/knowledge/dto/list-documents-query.dto.ts apps/api/src/modules/knowledge/dto/update-document-category.dto.ts apps/api/src/modules/knowledge/knowledge.controller.ts apps/api/test/knowledge.e2e-spec.ts
git commit -m "feat: category on upload/list + PATCH /knowledge/documents/:id/category"
```

---

### Task 6: Thread the employee's role through chat retrieval

**Files:**
- Modify: `apps/api/src/modules/employees/runtime/retrieval.service.ts`
- Modify: `apps/api/src/modules/employees/runtime/agent-runtime.service.ts:85-91`
- Create: `apps/api/src/modules/employees/runtime/retrieval.service.spec.ts`
- Create: `apps/api/test/knowledge-role-scoping.e2e-spec.ts`

**Interfaces:**
- Consumes: `KnowledgeService.retrieve(companyId, query, k, category?)` (Task 3), `employee.role: EmployeeRole` (already in scope in `agent-runtime.service.ts`).
- Produces: `RetrievalService.retrieve(companyId, query, knowledgeAccess, k, category?)` — this is the last task that touches retrieval; the workflow `RETRIEVE` node is explicitly untouched per the Global Constraints.

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/employees/runtime/retrieval.service.spec.ts`:

```typescript
import { RetrievalService } from './retrieval.service';

function fakeKnowledge() {
  return { retrieve: jest.fn().mockResolvedValue([]) };
}

describe('RetrievalService category threading', () => {
  it('passes the given category through to KnowledgeService.retrieve', async () => {
    const knowledge = fakeKnowledge();
    const service = new RetrievalService(knowledge as never);

    await service.retrieve('co_1', 'what is the refund policy', 'ALL', 5, 'SALES');

    expect(knowledge.retrieve).toHaveBeenCalledWith('co_1', 'what is the refund policy', 5, 'SALES');
  });

  it('still skips retrieval entirely when knowledgeAccess is NONE, regardless of category', async () => {
    const knowledge = fakeKnowledge();
    const service = new RetrievalService(knowledge as never);

    const result = await service.retrieve('co_1', 'anything', 'NONE', 5, 'SALES');

    expect(result).toEqual([]);
    expect(knowledge.retrieve).not.toHaveBeenCalled();
  });

  it('omitting the category preserves the original unfiltered call shape', async () => {
    const knowledge = fakeKnowledge();
    const service = new RetrievalService(knowledge as never);

    await service.retrieve('co_1', 'anything', 'ALL', 5);

    expect(knowledge.retrieve).toHaveBeenCalledWith('co_1', 'anything', 5, undefined);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `apps/api`: `npx jest --config ./test/jest-unit.json retrieval.service.spec.ts`
Expected: FAIL — `retrieve()` doesn't accept a 5th `category` argument yet.

- [ ] **Step 3: Update `RetrievalService`**

Replace the full contents of `apps/api/src/modules/employees/runtime/retrieval.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import type { EmployeeRole, KnowledgeAccess, SearchResultDto } from '@vaep/types';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { RETRIEVAL_K } from '../employees.constants';

/**
 * The "retrieve-knowledge" step of the agent loop. Delegates to the Knowledge
 * module's tenant-scoped pgvector search (KnowledgeService.retrieve) so the
 * embedding + cosine-similarity SQL is reused, not duplicated. Failures are
 * swallowed to an empty result so a retrieval hiccup never aborts a run.
 *
 * An employee whose `knowledgeAccess` is `NONE` skips retrieval entirely
 * (returns []); the default `ALL` preserves the original behaviour.
 *
 * `category` (the calling employee's role) scopes the search to that role's
 * documents plus Shared ones (docs/specs/2026-07-14-knowledge-role-scoping-
 * design.md) — omitting it preserves the original unfiltered behaviour.
 */
@Injectable()
export class RetrievalService {
  constructor(private readonly knowledge: KnowledgeService) {}

  async retrieve(
    companyId: string,
    query: string,
    knowledgeAccess: KnowledgeAccess = 'ALL',
    k: number = RETRIEVAL_K,
    category?: EmployeeRole,
  ): Promise<SearchResultDto[]> {
    if (knowledgeAccess === 'NONE') {
      return [];
    }
    const text = query.trim();
    if (!text) {
      return [];
    }
    return this.knowledge.retrieve(companyId, text, k, category);
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run from `apps/api`: `npx jest --config ./test/jest-unit.json retrieval.service.spec.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Update the one call site**

In `apps/api/src/modules/employees/runtime/agent-runtime.service.ts`, change the import:
```typescript
import {
  CONTEXT_CLOSE,
  CONTEXT_OPEN,
  MAX_ACT_ITERATIONS,
  ROLE_SCOPE,
  TOOL_RESULT_MARKER,
} from '../employees.constants';
```
to:
```typescript
import {
  CONTEXT_CLOSE,
  CONTEXT_OPEN,
  MAX_ACT_ITERATIONS,
  RETRIEVAL_K,
  ROLE_SCOPE,
  TOOL_RESULT_MARKER,
} from '../employees.constants';
```

Then change:
```typescript
    const sources = await this.retrieval.retrieve(
      companyId,
      userText,
      employee.knowledgeAccess,
    );
```
to:
```typescript
    const sources = await this.retrieval.retrieve(
      companyId,
      userText,
      employee.knowledgeAccess,
      RETRIEVAL_K,
      employee.role,
    );
```

- [ ] **Step 6: Write the e2e proof (role scoping end-to-end)**

Create `apps/api/test/knowledge-role-scoping.e2e-spec.ts`:

```typescript
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Needs a live Postgres + Redis, same convention as knowledge.e2e-spec.ts / employees.e2e-spec.ts.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SALES_TEXT = [
  'Acme Sales playbook: our enterprise discount is 15 percent for annual contracts',
  'over fifty seats. Sales reps should always mention the onboarding concierge.',
].join(' ');
const HR_TEXT = [
  'Acme HR payroll policy: salaries are reviewed every March and paid on the last',
  'business day of each month via direct deposit.',
].join(' ');

describeIfDb('Knowledge role scoping e2e (Sales employee never sees HR docs)', () => {
  let app: INestApplication;
  const email = `kb_scope_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  const auth: Record<string, string> = {};
  let salesEmployeeId = '';
  let conversationId = '';
  let salesDocId = '';
  let hrDocId = '';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'KB Scope E2E Co', name: 'Owner', email, password })
      .expect(201);
    auth.Authorization = `Bearer ${res.body.tokens.accessToken}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uploads and ingests a SALES document and an HR document', async () => {
    const salesUpload = await request(app.getHttpServer())
      .post('/knowledge/documents')
      .set(auth)
      .field('category', 'SALES')
      .attach('file', Buffer.from(SALES_TEXT, 'utf8'), {
        filename: 'sales-playbook.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    salesDocId = salesUpload.body.id;

    const hrUpload = await request(app.getHttpServer())
      .post('/knowledge/documents')
      .set(auth)
      .field('category', 'HR')
      .attach('file', Buffer.from(HR_TEXT, 'utf8'), {
        filename: 'payroll-policy.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    hrDocId = hrUpload.body.id;

    const deadline = Date.now() + 30_000;
    let salesReady = false;
    let hrReady = false;
    while (Date.now() < deadline && !(salesReady && hrReady)) {
      const [salesRes, hrRes] = await Promise.all([
        request(app.getHttpServer()).get(`/knowledge/documents/${salesDocId}`).set(auth),
        request(app.getHttpServer()).get(`/knowledge/documents/${hrDocId}`).set(auth),
      ]);
      salesReady = salesRes.body.status === 'READY';
      hrReady = hrRes.body.status === 'READY';
      if (!salesReady || !hrReady) await sleep(500);
    }
    expect(salesReady).toBe(true);
    expect(hrReady).toBe(true);
  }, 35_000);

  it('creates a SALES employee and asks about the payroll policy', async () => {
    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth)
      .send({ name: 'Sasha', role: 'SALES', persona: 'Enterprise sales rep.' })
      .expect(201);
    salesEmployeeId = emp.body.id;

    const conv = await request(app.getHttpServer())
      .post(`/employees/${salesEmployeeId}/conversations`)
      .set(auth)
      .send({ title: 'Payroll question' })
      .expect(201);
    conversationId = conv.body.id;

    const res = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/messages`)
      .set(auth)
      .send({ content: 'When are salaries reviewed and how are they paid out?' })
      .expect(201);

    // The SALES employee must never surface the HR-only document as a source.
    const sourceDocIds = (res.body.sources as { documentId: string }[]).map((s) => s.documentId);
    expect(sourceDocIds).not.toContain(hrDocId);
  });

  it('the same SALES employee CAN surface the SALES document', async () => {
    const conv = await request(app.getHttpServer())
      .post(`/employees/${salesEmployeeId}/conversations`)
      .set(auth)
      .send({ title: 'Discount question' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/conversations/${conv.body.id}/messages`)
      .set(auth)
      .send({ content: 'What is our enterprise discount for annual contracts over fifty seats?' })
      .expect(201);

    const sourceDocIds = (res.body.sources as { documentId: string }[]).map((s) => s.documentId);
    expect(sourceDocIds).toContain(salesDocId);
  });
});
```

- [ ] **Step 7: Run everything**

```bash
pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json
npx jest --config ./test/jest-unit.json retrieval.service.spec.ts
DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public REDIS_URL=redis://127.0.0.1:6380 \
LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local JWT_ACCESS_SECRET=test JWT_REFRESH_SECRET=test \
npx jest --config ./test/jest-e2e.json knowledge-role-scoping.e2e-spec.ts
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/employees/runtime/retrieval.service.ts apps/api/src/modules/employees/runtime/retrieval.service.spec.ts apps/api/src/modules/employees/runtime/agent-runtime.service.ts apps/api/test/knowledge-role-scoping.e2e-spec.ts
git commit -m "feat: scope AI-employee chat retrieval by the employee's role"
```

Before staging `agent-runtime.service.ts`, run `git diff apps/api/src/modules/employees/runtime/agent-runtime.service.ts` and confirm the diff contains only the import-list addition and the one call-site change described above.

---

### Task 7: Frontend API client + hooks for category

**Files:**
- Modify: `apps/web/src/features/knowledge/schemas.ts`
- Modify: `apps/web/src/features/knowledge/api.ts`
- Modify: `apps/web/src/features/knowledge/hooks.ts`

**Interfaces:**
- Consumes: `GET /knowledge/documents?category=`, `PATCH /knowledge/documents/:id/category`, `POST /knowledge/documents` with an optional `category` field (Task 5).
- Produces: `listDocuments(category?)`, `uploadDocument(file, category?)`, `updateDocumentCategory(id, category)`, `useDocuments(category?)`, `useUploadDocument()`, `useUpdateDocumentCategory()` — Task 8's components call these.

- [ ] **Step 1: Re-export `EmployeeRole`/`EMPLOYEE_ROLES` from the feature's schemas module**

Replace the full contents of `apps/web/src/features/knowledge/schemas.ts` with:

```typescript
// Re-export the shared validation contract so components import from the feature.
export { EMPLOYEE_ROLES, searchSchema } from '@vaep/types';
export type {
  DocumentStatus,
  EmployeeRole,
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
  UpdateDocumentCategoryDto,
} from '@vaep/types';
```

- [ ] **Step 2: Update `api.ts`**

Replace the full contents of `apps/web/src/features/knowledge/api.ts` with:

```typescript
import { apiClient } from '@/lib/apiClient';
import type {
  EmployeeRole,
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
} from '@vaep/types';

export async function listDocuments(
  category?: EmployeeRole,
): Promise<KnowledgeDocumentDto[]> {
  const { data } = await apiClient.get<KnowledgeDocumentDto[]>(
    '/knowledge/documents',
    { params: category ? { category } : undefined },
  );
  return data;
}

export async function uploadDocument(
  file: File,
  category?: EmployeeRole,
): Promise<KnowledgeDocumentDto> {
  const form = new FormData();
  form.append('file', file);
  if (category) {
    form.append('category', category);
  }
  // Override the client's default application/json: with a multipart body the
  // browser sets Content-Type (incl. the boundary) itself. Leaving json here
  // would make axios serialize the FormData to JSON and drop the file.
  const { data } = await apiClient.post<KnowledgeDocumentDto>(
    '/knowledge/documents',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function deleteDocument(id: string): Promise<void> {
  await apiClient.delete(`/knowledge/documents/${id}`);
}

export async function updateDocumentCategory(
  id: string,
  category: EmployeeRole | null,
): Promise<KnowledgeDocumentDto> {
  const { data } = await apiClient.patch<KnowledgeDocumentDto>(
    `/knowledge/documents/${id}/category`,
    { category },
  );
  return data;
}

export async function getDocumentContent(id: string): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(
    `/knowledge/documents/${id}/content`,
    { responseType: 'blob' },
  );
  return data;
}

export async function searchKnowledge(
  payload: SearchQueryDto,
): Promise<SearchResultDto[]> {
  const { data } = await apiClient.post<SearchResultDto[]>(
    '/knowledge/search',
    payload,
  );
  return data;
}
```

- [ ] **Step 3: Update `hooks.ts`**

In `apps/web/src/features/knowledge/hooks.ts`, change the imports:
```typescript
import type {
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import {
  deleteDocument,
  getDocumentContent,
  listDocuments,
  searchKnowledge,
  uploadDocument,
} from './api';
```
to:
```typescript
import type {
  EmployeeRole,
  KnowledgeDocumentDto,
  SearchQueryDto,
  SearchResultDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import {
  deleteDocument,
  getDocumentContent,
  listDocuments,
  searchKnowledge,
  updateDocumentCategory,
  uploadDocument,
} from './api';
```

Change the query keys and `useDocuments`:
```typescript
export const knowledgeKeys = {
  documents: ['knowledge', 'documents'] as const,
};
```
to:
```typescript
export const knowledgeKeys = {
  documents: (category?: EmployeeRole) =>
    ['knowledge', 'documents', category ?? 'all'] as const,
};
```

```typescript
export function useDocuments() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<KnowledgeDocumentDto[], NormalizedApiError>({
    queryKey: knowledgeKeys.documents,
    queryFn: listDocuments,
    enabled: Boolean(accessToken),
    refetchInterval: (query) =>
      hasActiveIngestion(query.state.data) ? 2000 : false,
  });
}
```
to:
```typescript
export function useDocuments(category?: EmployeeRole) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<KnowledgeDocumentDto[], NormalizedApiError>({
    queryKey: knowledgeKeys.documents(category),
    queryFn: () => listDocuments(category),
    enabled: Boolean(accessToken),
    refetchInterval: (query) =>
      hasActiveIngestion(query.state.data) ? 2000 : false,
  });
}
```

`useUploadDocument`, `useDeleteDocument`: replace every remaining `knowledgeKeys.documents` reference (as
a bare query-key value) with `knowledgeKeys.documents()` (no-args — invalidates/rolls back the unfiltered
"all" cache entry; the filtered per-role entries simply refetch on their own next mount, same as any
other TanStack Query cache miss). There are **10 occurrences total** — 5 in each hook, all following the
same shape as today, just with `()` added:

- `qc.cancelQueries({ queryKey: knowledgeKeys.documents })` → `...documents() })` (1 per hook, in `onMutate`)
- `qc.getQueryData<KnowledgeDocumentDto[]>(knowledgeKeys.documents)` → `...documents())` (1 per hook, in `onMutate`)
- `qc.setQueryData<KnowledgeDocumentDto[]>(knowledgeKeys.documents, (old) => ...)` → `...documents(), (old) => ...)` (1 per hook, the optimistic update in `onMutate`)
- `qc.setQueryData(knowledgeKeys.documents, context.previous)` → `...documents(), context.previous)` (1 per hook, the rollback in `onError`)
- `qc.invalidateQueries({ queryKey: knowledgeKeys.documents })` → `...documents() })` (1 per hook, in `onSettled`)

Every one of the 10 becomes a function call (`knowledgeKeys.documents()`), never a bare property access.

Also update `useUploadDocument`'s mutation signature so it can pass a category through:
```typescript
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation<
    KnowledgeDocumentDto,
    NormalizedApiError,
    File,
    UploadContext
  >({
    mutationFn: uploadDocument,
    onMutate: async (file) => {
```
to:
```typescript
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation<
    KnowledgeDocumentDto,
    NormalizedApiError,
    { file: File; category?: EmployeeRole },
    UploadContext
  >({
    mutationFn: ({ file, category }) => uploadDocument(file, category),
    onMutate: async ({ file }) => {
```

(The rest of `onMutate`'s body is unchanged — it already builds its optimistic row from `file`, which is
now destructured from the mutation variable instead of being the variable itself. Add `category:
category ?? null,` to the `optimistic` object literal it builds, right after `chunkCount: 0,`.)

Finally, add a new mutation hook at the end of the file, after `useSearchKnowledge`:
```typescript
/** Retag mutation — invalidates the documents cache on success so every open view (global + per-employee) refetches. */
export function useUpdateDocumentCategory() {
  const qc = useQueryClient();
  return useMutation<
    KnowledgeDocumentDto,
    NormalizedApiError,
    { id: string; category: EmployeeRole | null }
  >({
    mutationFn: ({ id, category }) => updateDocumentCategory(id, category),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['knowledge', 'documents'] });
    },
  });
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @vaep/web exec tsc --noEmit
```
Expected: fails only in `DocumentList.tsx`/`UploadPanel.tsx` (still calling `useUploadDocument().mutate(file)`
with the old single-argument shape — fixed in Task 8) and passes everywhere else in this feature.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/knowledge/schemas.ts apps/web/src/features/knowledge/api.ts apps/web/src/features/knowledge/hooks.ts
git commit -m "feat: category-aware knowledge API client + hooks"
```

---

### Task 8: `DocumentList`/`UploadPanel` — category filter + retag UI

**Files:**
- Modify: `apps/web/src/features/knowledge/components/DocumentList.tsx`
- Modify: `apps/web/src/features/knowledge/components/UploadPanel.tsx`

**Interfaces:**
- Consumes: `useDocuments(category?)`, `useUploadDocument()`, `useUpdateDocumentCategory()` (Task 7), `formatRole` from `features/employees/labels.ts`, `EMPLOYEE_ROLES`/`EmployeeRole` from `features/knowledge/schemas.ts`.
- Produces: `<DocumentList category?: EmployeeRole>` and `<UploadPanel defaultCategory?: EmployeeRole>` — Task 9's employee page and the existing global `/knowledge` page both render these.

- [ ] **Step 1: Add the category filter + retag dropdown to `DocumentList`**

Replace the full contents of `apps/web/src/features/knowledge/components/DocumentList.tsx` with:

```typescript
'use client';

import { ChevronRight, File, FileCode, FileText, type LucideIcon } from 'lucide-react';
import type { DocumentStatus } from '@vaep/types';
import { formatRole } from '@/features/employees/labels';
import { EMPLOYEE_ROLES, type EmployeeRole } from '../schemas';
import { useDeleteDocument, useDocuments, useUpdateDocumentCategory, useViewDocument } from '../hooks';

const STATUS_STYLES: Record<DocumentStatus, string> = {
  PENDING: 'bg-white/[0.06] text-zinc-400',
  PROCESSING: 'bg-amber-500/15 text-amber-400',
  READY: 'bg-green-500/15 text-green-400',
  FAILED: 'bg-red-500/15 text-red-400',
};

function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

/** Icon + accent chip + short label derived from the document's real mimeType. */
function fileTypeMeta(mimeType: string): { label: string; Icon: LucideIcon; chip: string } {
  if (mimeType === 'application/pdf') {
    return { label: 'PDF', Icon: FileText, chip: 'bg-red-500/15 text-red-400' };
  }
  if (mimeType === 'text/markdown') {
    return { label: 'Markdown', Icon: FileCode, chip: 'bg-sky-500/15 text-sky-400' };
  }
  if (mimeType === 'text/plain') {
    return { label: 'Text', Icon: File, chip: 'bg-green-500/15 text-green-400' };
  }
  return { label: mimeType, Icon: File, chip: 'bg-white/[0.06] text-zinc-400' };
}

/**
 * Reused by both the global `/knowledge` page (no `category` — shows every
 * document, with the retag dropdown to assign one) and each AI Employee's
 * "Knowledge" tab (`category` = that employee's role — shows that role's
 * documents + Shared, retag dropdown still available).
 */
export function DocumentList({ category }: { category?: EmployeeRole } = {}) {
  const { data: docs, isLoading } = useDocuments(category);
  const del = useDeleteDocument();
  const view = useViewDocument();
  const retag = useUpdateDocumentCategory();

  if (isLoading) {
    return <p className="text-sm text-zinc-500">Loading documents…</p>;
  }

  if (!docs || docs.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No documents yet. Upload one to get started.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      {docs.map((doc) => {
        const isTemp = doc.id.startsWith('temp_');
        const { label, Icon, chip } = fileTypeMeta(doc.mimeType);
        const detail =
          doc.status === 'READY'
            ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}`
            : doc.status === 'FAILED'
              ? (doc.error ?? 'Ingestion failed')
              : 'Processing…';

        return (
          <li
            key={doc.id}
            className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${chip}`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {doc.filename}
              </p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {label} · {detail}
              </p>
            </div>
            <StatusBadge status={doc.status} />
            <select
              className="field-modern !w-auto shrink-0 !py-1.5 text-xs"
              value={doc.category ?? ''}
              disabled={isTemp || retag.isPending}
              onChange={(e) =>
                retag.mutate({
                  id: doc.id,
                  category: e.target.value === '' ? null : (e.target.value as EmployeeRole),
                })
              }
            >
              <option value="">Shared (everyone)</option>
              {EMPLOYEE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {formatRole(role)}
                </option>
              ))}
            </select>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => view.mutate(doc.id)}
                disabled={isTemp || view.isPending}
                className="text-xs font-medium text-zinc-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                View
              </button>
              <button
                type="button"
                onClick={() => del.mutate(doc.id)}
                disabled={isTemp || del.isPending}
                className="text-xs font-medium text-zinc-500 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete
              </button>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Add the default-category toggle to `UploadPanel`**

Replace the full contents of `apps/web/src/features/knowledge/components/UploadPanel.tsx` with:

```typescript
'use client';

import { useState, type ChangeEvent } from 'react';
import { formatRole } from '@/features/employees/labels';
import { EMPLOYEE_ROLES, type EmployeeRole } from '../schemas';
import { useUploadDocument } from '../hooks';

/**
 * Upload control. A <label> wraps a visually-hidden <input type="file">, so the
 * styled button triggers the native picker declaratively — no useRef needed.
 *
 * `defaultCategory` (an AI Employee's own role, when rendered from that
 * employee's "Knowledge" tab) is pre-selected so day-to-day uploads need no
 * manual tagging step; the global `/knowledge` page renders this with no
 * `defaultCategory`, defaulting new uploads to Shared, with a dropdown to
 * pick a specific role instead.
 */
export function UploadPanel({ defaultCategory }: { defaultCategory?: EmployeeRole } = {}) {
  const upload = useUploadDocument();
  const [category, setCategory] = useState<EmployeeRole | ''>(defaultCategory ?? '');

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      upload.mutate({ file, category: category === '' ? undefined : category });
    }
    // Reset so selecting the same file again re-fires onChange.
    e.target.value = '';
  };

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 transition-colors hover:border-white/[0.14]">
      <h2 className="mb-1 text-sm font-medium text-zinc-400">Upload documents</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Upload .txt, .md, or .pdf files to add them to your knowledge base.
      </p>
      <label htmlFor="upload-category" className="mb-1 block text-xs font-medium text-zinc-500">
        Visible to
      </label>
      <select
        id="upload-category"
        className="field-modern mb-4 w-full"
        value={category}
        onChange={(e) => setCategory(e.target.value as EmployeeRole | '')}
      >
        <option value="">Shared (everyone)</option>
        {EMPLOYEE_ROLES.map((role) => (
          <option key={role} value={role}>
            {formatRole(role)}
          </option>
        ))}
      </select>
      <label
        className={`inline-flex cursor-pointer items-center justify-center rounded-xl bg-[linear-gradient(135deg,#6a30ec_0%,#5216dd_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_34px_-12px_rgba(91,33,230,0.85)] transition-all hover:-translate-y-0.5 hover:brightness-110 ${
          upload.isPending ? 'cursor-not-allowed opacity-60' : ''
        }`}
      >
        {upload.isPending ? 'Uploading…' : '+ Upload'}
        <input
          type="file"
          className="sr-only"
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          onChange={onChange}
          disabled={upload.isPending}
        />
      </label>
      {upload.isError && (
        <p className="mt-2 text-sm text-red-400">
          {upload.error?.message ?? 'Upload failed'}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @vaep/web exec tsc --noEmit
```
Expected: no errors in the `knowledge` feature.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/knowledge/components/DocumentList.tsx apps/web/src/features/knowledge/components/UploadPanel.tsx
git commit -m "feat: category filter + retag dropdown in DocumentList/UploadPanel"
```

---

### Task 9: Employee "Knowledge" tab + remove the global nav entry

**Files:**
- Modify: `apps/web/src/app/(app)/employees/[id]/page.tsx`
- Modify: `apps/web/src/components/app-shell/Sidebar.tsx`

**Interfaces:**
- Consumes: `<DocumentList category?>`, `<UploadPanel defaultCategory?>` (Task 8), `employee.role: EmployeeRole` (already loaded via `useEmployee`).

- [ ] **Step 1: Add the "Knowledge" tab**

In `apps/web/src/app/(app)/employees/[id]/page.tsx`, change the imports:
```typescript
import { ChatPanel } from '@/features/employees/components/ChatPanel';
import { EmployeeAbout } from '@/features/employees/components/EmployeeAbout';
import { EmployeeSettings } from '@/features/employees/components/EmployeeSettings';
import { LearningPanel } from '@/features/employees/components/LearningPanel';
import {
  useConversations,
  useEmployee,
  useStartConversation,
  useUpdateEmployee,
} from '@/features/employees/hooks';
import { STATUS_STYLES, formatRole } from '@/features/employees/labels';
import { EmployeeSkillPicker } from '@/features/skills/components/EmployeeSkillPicker';
```
to:
```typescript
import { ChatPanel } from '@/features/employees/components/ChatPanel';
import { EmployeeAbout } from '@/features/employees/components/EmployeeAbout';
import { EmployeeSettings } from '@/features/employees/components/EmployeeSettings';
import { LearningPanel } from '@/features/employees/components/LearningPanel';
import {
  useConversations,
  useEmployee,
  useStartConversation,
  useUpdateEmployee,
} from '@/features/employees/hooks';
import { STATUS_STYLES, formatRole } from '@/features/employees/labels';
import { DocumentList } from '@/features/knowledge/components/DocumentList';
import { UploadPanel } from '@/features/knowledge/components/UploadPanel';
import { EmployeeSkillPicker } from '@/features/skills/components/EmployeeSkillPicker';
```

Change the tab type and list:
```typescript
type TabId = 'overview' | 'chat' | 'memory' | 'tools' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'chat', label: 'Chat' },
  { id: 'memory', label: 'Memory' },
  { id: 'tools', label: 'Tools' },
  { id: 'settings', label: 'Settings' },
];
```
to:
```typescript
type TabId = 'overview' | 'chat' | 'memory' | 'tools' | 'knowledge' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'chat', label: 'Chat' },
  { id: 'memory', label: 'Memory' },
  { id: 'tools', label: 'Tools' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'settings', label: 'Settings' },
];
```

Change the `activeTab` state type to match:
```typescript
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'memory' | 'tools' | 'settings'>(
    'overview',
  );
```
to:
```typescript
  const [activeTab, setActiveTab] = useState<TabId>('overview');
```

Add the new tab's content, immediately after the `{activeTab === 'tools' && ...}` block and before
`{activeTab === 'settings' && ...}`:
```typescript
      {activeTab === 'tools' && <EmployeeSkillPicker employeeId={employeeId} />}
```
becomes:
```typescript
      {activeTab === 'tools' && <EmployeeSkillPicker employeeId={employeeId} />}

      {activeTab === 'knowledge' &&
        (employee ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="order-2 lg:order-1 lg:col-span-2">
              <h2 className="mb-3 text-sm font-medium text-zinc-400">
                {formatRole(employee.role)} + Shared documents
              </h2>
              <DocumentList category={employee.role} />
            </section>
            <div className="order-1 lg:order-2">
              <UploadPanel defaultCategory={employee.role} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Loading…</p>
        ))}
```

- [ ] **Step 2: Remove the Sidebar's `/knowledge` nav entry**

In `apps/web/src/components/app-shell/Sidebar.tsx`, remove the now-unused `BookOpen` import:
```typescript
import {
  Activity,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  LayoutDashboard,
  BookOpen,
  ShoppingBag,
  Sparkles,
  UsersRound,
  Workflow,
  Users,
} from 'lucide-react';
```
to:
```typescript
import {
  Activity,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  LayoutDashboard,
  ShoppingBag,
  Sparkles,
  UsersRound,
  Workflow,
  Users,
} from 'lucide-react';
```

And remove the nav entry itself:
```typescript
const NAV_PRIMARY: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/employees', label: 'AI Employees', icon: Users },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/scheduling', label: 'Scheduling', icon: CalendarClock },
  { href: '/marketplace', label: 'Marketplace', icon: ShoppingBag },
];
```
to:
```typescript
const NAV_PRIMARY: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/employees', label: 'AI Employees', icon: Users },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/scheduling', label: 'Scheduling', icon: CalendarClock },
  { href: '/marketplace', label: 'Marketplace', icon: ShoppingBag },
];
```

The `/knowledge` page itself (`apps/web/src/app/(app)/knowledge/page.tsx`) is untouched and stays reachable
by direct link (per the Global Constraints — it's the easiest place to retag the pre-existing documents,
since it shows every document regardless of category).

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @vaep/web exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual verification**

Start the dev servers (`pnpm dev` from `platform/`), register a throwaway test company, hire a Sales
employee and an HR employee, open the Sales employee's page, confirm the new "Knowledge" tab appears
between Tools and Settings, upload a document from it, confirm it appears tagged `SALES` on the global
`/knowledge` page, and confirm the Sidebar no longer shows a "Knowledge" entry. Per this project's
standing convention, kill the dev server afterward so ports 3000/4000 are free.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/employees/[id]/page.tsx" apps/web/src/components/app-shell/Sidebar.tsx
git commit -m "feat: per-employee Knowledge tab; remove global Knowledge from Sidebar nav"
```
