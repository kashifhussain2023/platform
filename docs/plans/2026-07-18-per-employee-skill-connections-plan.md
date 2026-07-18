# Per-Employee Skill Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let a company connect the same skill type more than once — starting with Gmail — each
connection owned by one specific AI Employee (so `hr@company.com`, `support@company.com`, `sales@company.com`
can each be its own employee's mailbox), and make sure an incoming event only triggers the workflows
scoped to the mailbox it came from.

**Architecture:** add a nullable `employeeId` to `InstalledSkill` (null = today's company-wide behavior,
unchanged); thread the firing connector's id through `WorkflowsService.fireEvent` so a workflow can
optionally scope its EVENT trigger to one specific connector via `triggerConfig.connectorId`.

**Tech Stack:** NestJS + Prisma + Postgres (backend), Next.js + TanStack Query (frontend), the existing
`@vaep/types` shared package.

## Global Constraints

- `InstalledSkill.employeeId = null` means company-wide — **every existing row keeps this exact
  behavior**; nothing about this plan reinterprets or migrates existing data.
- Duplicate-connection prevention (no two company-wide Gmail rows; no employee connecting the same skill
  twice) is an **application-level check** in `SkillsService.install()`, extended to match on `employeeId`
  too — not a Postgres partial unique index. The residual race-condition risk is identical in kind to
  what already exists today for the 2-field version of this same check.
- `WorkflowsService.fireEvent`'s existing company+eventType query is **unchanged**; connector-scoping is
  an additional in-process filter, applied the same way `conditions` already are — a workflow with no
  `connectorId` set keeps matching every connector of that event type (today's exact behavior).
- The existing global `/skills` catalog page and its company-wide "Connect Gmail" flow are untouched.
- No new email provider, no push/webhook subscriptions, no OAuth-grant revocation on delete — all
  explicitly out of scope (see the design spec's own "out of scope" section).
- Per this repo's pgvector/Prisma gotcha (`platform/CLAUDE.md`): `prisma migrate dev` cannot run at all in
  this non-interactive shell. Author the migration via `npx prisma migrate diff --from-url <db-url>
  --to-schema-datamodel ./prisma/schema.prisma --script`, hand-place the output SQL into a
  correctly-timestamped `prisma/migrations/<ts>_<name>/` folder, then apply via `pnpm run prisma:migrate`
  (`migrate deploy`) — the same sequence used successfully for this exact reason in a prior task in this
  session.

---

### Task 1: Prisma schema — `InstalledSkill.employeeId`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`InstalledSkill` model, `AiEmployee` model)
- Create: `apps/api/prisma/migrations/<timestamp>_installed_skill_employee/migration.sql` (generated, then verified)

**Interfaces:**
- Produces: `InstalledSkill.employeeId: string | null`, compound unique key
  `companyId_skillKey_employeeId` — every later task reads/writes this.

- [ ] **Step 1: Add `employeeId` to `InstalledSkill` and the back-relation to `AiEmployee`**

In `apps/api/prisma/schema.prisma`, change:

```prisma
model InstalledSkill {
  id          String   @id @default(cuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  skillKey    String
  displayName String
  // Non-secret company-specific settings (mirrors the catalog configSchema).
  config      Json?
  enabled     Boolean  @default(true)
  // Connection state. connectionType mirrors the catalog ('oauth'|'api_key'|'none');
  // credentials holds SECRETS (api keys / oauth tokens) and is NEVER returned raw.
  connectionType   String?
  connectionStatus SkillConnectionStatus @default(NOT_CONNECTED)
  credentials      Json?
  // --- Connector health / lifecycle (Unit B, docs §1.6–1.8) ---
  // lastHealthCheckAt/lastHealthError: last active probe timestamp + error.
  // consecutiveErrors: rolling egress/probe failure count; ≥N → DEGRADED.
  // tokenExpiresAt: cached OAuth access-token expiry (drives single-flight refresh).
  // disabledReason: why the connector was auto-DISCONNECTED (revoked/invalid_grant).
  // inboundCursor: per-connector inbound polling watermark (e.g. Gmail historyId);
  //   null → not yet baselined (first poll stores the current cursor, fires nothing).
  lastHealthCheckAt DateTime?
  lastHealthError   String?
  consecutiveErrors Int      @default(0)
  tokenExpiresAt    DateTime?
  disabledReason    String?
  inboundCursor     String?
  createdAt   DateTime @default(now())

  employees EmployeeSkill[]

  @@unique([companyId, skillKey])
  @@index([companyId])
}
```

to:

```prisma
model InstalledSkill {
  id          String   @id @default(cuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  skillKey    String
  // null = company-wide (today's exact behavior, unchanged for every existing
  // row); set = this connection is owned by, and only by, that one AiEmployee
  // (docs/specs/2026-07-18-per-employee-skill-connections-design.md).
  employeeId  String?
  employee    AiEmployee? @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  displayName String
  // Non-secret company-specific settings (mirrors the catalog configSchema).
  config      Json?
  enabled     Boolean  @default(true)
  // Connection state. connectionType mirrors the catalog ('oauth'|'api_key'|'none');
  // credentials holds SECRETS (api keys / oauth tokens) and is NEVER returned raw.
  connectionType   String?
  connectionStatus SkillConnectionStatus @default(NOT_CONNECTED)
  credentials      Json?
  // --- Connector health / lifecycle (Unit B, docs §1.6–1.8) ---
  // lastHealthCheckAt/lastHealthError: last active probe timestamp + error.
  // consecutiveErrors: rolling egress/probe failure count; ≥N → DEGRADED.
  // tokenExpiresAt: cached OAuth access-token expiry (drives single-flight refresh).
  // disabledReason: why the connector was auto-DISCONNECTED (revoked/invalid_grant).
  // inboundCursor: per-connector inbound polling watermark (e.g. Gmail historyId);
  //   null → not yet baselined (first poll stores the current cursor, fires nothing).
  lastHealthCheckAt DateTime?
  lastHealthError   String?
  consecutiveErrors Int      @default(0)
  tokenExpiresAt    DateTime?
  disabledReason    String?
  inboundCursor     String?
  createdAt   DateTime @default(now())

  employees EmployeeSkill[]

  @@unique([companyId, skillKey, employeeId])
  @@index([companyId])
  @@index([employeeId])
}
```

Then, in the same file, add the back-relation array to `AiEmployee` (needed because Prisma requires both
sides of a relation to be declared) — change:

```prisma
  conversations  Conversation[]
  memories       EmployeeMemory[]
  employeeSkills EmployeeSkill[]
  feedback       EmployeeFeedback[]

  @@index([companyId])
}

model Conversation {
```

to:

```prisma
  conversations   Conversation[]
  memories        EmployeeMemory[]
  employeeSkills  EmployeeSkill[]
  feedback        EmployeeFeedback[]
  installedSkills InstalledSkill[]

  @@index([companyId])
}

model Conversation {
```

- [ ] **Step 2: Generate the migration**

Run from `apps/api`:

```bash
npx prisma migrate diff \
  --from-url "postgresql://vaep:vaep@localhost:5433/vaep?schema=public" \
  --to-schema-datamodel ./prisma/schema.prisma \
  --script
```

(`migrate dev` cannot run at all in this non-interactive shell — this is the same
`migrate diff --script` workaround used successfully earlier in this project; see
`platform/.claude/projects` memory `permission-and-hook-setup-2026-07-18` if present, or just proceed —
it is a standard, documented Prisma pattern for headless environments.)

- [ ] **Step 3: Verify the generated SQL, hand-place it, apply it**

The printed SQL should be exactly two statements (order may differ):

```sql
ALTER TABLE "InstalledSkill" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "InstalledSkill" DROP CONSTRAINT "InstalledSkill_companyId_skillKey_key";
ALTER TABLE "InstalledSkill" ADD CONSTRAINT "InstalledSkill_companyId_skillKey_employeeId_key" UNIQUE ("companyId", "skillKey", "employeeId");
CREATE INDEX "InstalledSkill_employeeId_idx" ON "InstalledSkill"("employeeId");
ALTER TABLE "InstalledSkill" ADD CONSTRAINT "InstalledSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "AiEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

(Exact constraint names may vary slightly — Prisma derives them from the model/field names; what matters
is: one `ADD COLUMN`, the old 2-field unique constraint replaced by the new 3-field one, one new index,
one new FK with `ON DELETE CASCADE`. There must be **no** `DROP INDEX`/`DROP TABLE` touching anything
other than `InstalledSkill`'s own old unique constraint, and nothing about `KnowledgeChunk`'s embedding
index — if you see anything unrelated, stop and re-diff.)

Create `prisma/migrations/<timestamp>_installed_skill_employee/` (timestamp format `YYYYMMDDHHMMSS`,
matching every sibling migration folder) containing a `migration.sql` with exactly that SQL, then apply:

```bash
pnpm run prisma:migrate
pnpm --filter @vaep/api run prisma:generate
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json
```

Expected: fails with errors about `companyId_skillKey` no longer existing as a valid Prisma where-key in
`skills.service.ts` (two call sites) — this is expected and fixed in Task 3. Confirm there are no OTHER
errors (schema/client generation itself must be clean).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat: add employeeId to InstalledSkill for per-employee connections"
```

---

### Task 2: Shared types for employee-owned connections + connector-scoped triggers

**Files:**
- Modify: `packages/types/src/index.ts` (`InstalledSkillDto`, `installSkillSchema`, `TriggerConfig`)

**Interfaces:**
- Produces: `InstalledSkillDto.employeeId: string | null`, `InstallSkillDto.employeeId?: string`,
  `TriggerConfig.connectorId?: string` — Tasks 3, 4, 6, 7, 8 all consume these.

- [ ] **Step 1: Add `employeeId` to `InstalledSkillDto`**

Change:

```typescript
export interface InstalledSkillDto {
  id: string;
  companyId: string;
  skillKey: string;
  displayName: string;
  /** Non-secret company-specific settings. */
  config: Record<string, unknown> | null;
  enabled: boolean;
  /** Connection type (mirrors the catalog); null until first set. */
  connectionType: SkillConnectionType | null;
  /** Whether credentials have been supplied / the skill is connected. */
  connectionStatus: SkillConnectionStatus;
  /**
   * True when secret credentials are stored. Raw credentials are NEVER returned
   * — this is the masked indicator the UI uses.
   */
  credentialsSet: boolean;
  createdAt: string;
}
```

to:

```typescript
export interface InstalledSkillDto {
  id: string;
  companyId: string;
  skillKey: string;
  /** null = company-wide; set = owned by, and only by, that one AiEmployee. */
  employeeId: string | null;
  displayName: string;
  /** Non-secret company-specific settings. */
  config: Record<string, unknown> | null;
  enabled: boolean;
  /** Connection type (mirrors the catalog); null until first set. */
  connectionType: SkillConnectionType | null;
  /** Whether credentials have been supplied / the skill is connected. */
  connectionStatus: SkillConnectionStatus;
  /**
   * True when secret credentials are stored. Raw credentials are NEVER returned
   * — this is the masked indicator the UI uses.
   */
  credentialsSet: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Add optional `employeeId` to the install schema**

Change:

```typescript
export const installSkillSchema = z.object({
  skillKey: z.string().min(1, 'Skill key is required').max(80),
  displayName: z.string().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
});
```

to:

```typescript
export const installSkillSchema = z.object({
  skillKey: z.string().min(1, 'Skill key is required').max(80),
  /** Owning employee for a per-employee connection; omit for company-wide. */
  employeeId: z.string().min(1).optional(),
  displayName: z.string().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
});
```

- [ ] **Step 3: Add optional `connectorId` to `TriggerConfig`**

Change:

```typescript
export interface TriggerConfig {
  /** SCHEDULE: repeat interval in ms (min 15000). */
  everyMs?: number;
  /** SCHEDULE: cron expression (alternative to everyMs). */
  cron?: string;
  /** EVENT: the internal event name this workflow listens for. */
  eventType?: string;
  /**
   * EVENT: optional predicate list — the workflow fires only when every condition
   * passes against the fired payload. Empty/absent → always fire (back-compat).
   */
  conditions?: Condition[];
}
```

to:

```typescript
export interface TriggerConfig {
  /** SCHEDULE: repeat interval in ms (min 15000). */
  everyMs?: number;
  /** SCHEDULE: cron expression (alternative to everyMs). */
  cron?: string;
  /** EVENT: the internal event name this workflow listens for. */
  eventType?: string;
  /**
   * EVENT: optional predicate list — the workflow fires only when every condition
   * passes against the fired payload. Empty/absent → always fire (back-compat).
   */
  conditions?: Condition[];
  /**
   * EVENT: restrict this trigger to ONE specific connector (InstalledSkill.id) —
   * e.g. one employee's own Gmail connection. Absent → matches every connector
   * of this eventType (today's exact behavior, unchanged).
   */
  connectorId?: string;
}
```

- [ ] **Step 4: Add optional `connectorId` to the manual fire-event schema**

Change:

```typescript
/** POST /workflows/events body — fire an internal event to EVENT-triggered flows. */
export const fireEventSchema = z.object({
  eventType: z.string().min(1).max(120),
  payload: z.record(z.unknown()).optional(),
});
```

to:

```typescript
/** POST /workflows/events body — fire an internal event to EVENT-triggered flows. */
export const fireEventSchema = z.object({
  eventType: z.string().min(1).max(120),
  payload: z.record(z.unknown()).optional(),
  /** Restrict which connector-scoped triggers this fire can match (see TriggerConfig.connectorId). */
  connectorId: z.string().optional(),
});
```

- [ ] **Step 5: Build and typecheck**

```bash
pnpm --filter @vaep/types build
pnpm --filter @vaep/types exec tsc --noEmit
```

Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

Before staging, run `git diff packages/types/src/index.ts` and confirm the diff contains **only** the
four changes above — this file has a documented history in this repo of picking up unrelated dirty
content from other in-progress work.

```bash
git add packages/types/src/index.ts
git commit -m "feat: add employeeId to InstalledSkillDto/installSkillSchema, connectorId to TriggerConfig"
```

---

### Task 3: `SkillsService` — employee-owned install + execution-time resolution

**Note (discovered during Task 1's review, confirmed by direct grep against the current repo):**
widening `InstalledSkill`'s unique constraint from `(companyId, skillKey)` to `(companyId, skillKey,
employeeId)` breaks the Prisma-generated `companyId_skillKey` compound-key name everywhere it's used —
**6 call sites across 4 files**, not just the 2 in `skills.service.ts` originally scoped here:
`skills.service.ts` (install's duplicate check, `resolveExecutorContext`), `scheduling.service.ts`
(`getCalendarAccessToken`, `getCalendarSettings`), `workflow-engine.service.ts` (the TOOL_ACTION
quarantine check), and `connector-health.service.ts` (`byKey`). This task now fixes all 6, so the whole
package typechecks clean again in one commit rather than leaving it partially broken between tasks. The
3 call sites outside `skills.service.ts` are NOT employee-context-aware and don't need to become so —
they're fixed as pure mechanical, behavior-preserving compiles (explicit `employeeId: null`, reproducing
the exact query the old 2-field key already performed).

**Files:**
- Modify: `apps/api/src/modules/skills/skills.service.ts`
- Modify: `apps/api/src/modules/skills/dto/install-skill.dto.ts`
- Modify: `apps/api/src/modules/skills/skills.mapper.ts`
- Modify: `apps/api/src/modules/scheduling/scheduling.service.ts`
- Modify: `apps/api/src/modules/workflows/engine/workflow-engine.service.ts`
- Modify: `apps/api/src/modules/skills/connectors/connector-health.service.ts`
- Modify: `apps/api/test/skills.e2e-spec.ts`

**Interfaces:**
- Consumes: `InstalledSkill.employeeId` (Task 1), `InstallSkillDto.employeeId`/`InstalledSkillDto.employeeId` (Task 2).
- Produces: `SkillsService.install()` accepting an optional owning employee; `resolveExecutorContext`
  preferring an employee's own connection over the company-wide one — Task 6 (frontend) and the runtime
  tool-calling path both depend on this. The whole `apps/api` package typechecks clean again after this
  task (it does not before, by design, since Task 1 alone leaves the widened constraint's call sites broken).

- [ ] **Step 1: Add `employeeId` to the install DTO**

Replace the full contents of `apps/api/src/modules/skills/dto/install-skill.dto.ts` with:

```typescript
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { InstallSkillDto as IInstallSkillDto } from '@vaep/types';

/** POST /skills/install body. Mirrors the shared @vaep/types contract. */
export class InstallSkillDto implements IInstallSkillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  skillKey!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  employeeId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
```

- [ ] **Step 2: Add `employeeId` to the mapper**

In `apps/api/src/modules/skills/skills.mapper.ts`, change:

```typescript
  return {
    id: s.id,
    companyId: s.companyId,
    skillKey: s.skillKey,
    displayName: s.displayName,
```

to:

```typescript
  return {
    id: s.id,
    companyId: s.companyId,
    skillKey: s.skillKey,
    employeeId: s.employeeId,
    displayName: s.displayName,
```

- [ ] **Step 3: Rewrite `install()` to accept an owning employee (transactional, auto-assigns)**

In `apps/api/src/modules/skills/skills.service.ts`, replace:

```typescript
  async install(
    companyId: string,
    dto: InstallSkillDto,
  ): Promise<InstalledSkillDto> {
    const def = SkillCatalog.get(dto.skillKey);
    if (!def) {
      throw new NotFoundException(`Unknown skill: ${dto.skillKey}`);
    }
    const existing = await this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey: { companyId, skillKey: dto.skillKey } },
    });
    if (existing) {
      throw new ConflictException('Skill is already installed');
    }
    const row = await this.prisma.installedSkill.create({
      data: {
        companyId,
        skillKey: dto.skillKey,
        displayName: dto.displayName?.trim() || def.name,
        config:
          dto.config === undefined
            ? undefined
            : (dto.config as Prisma.InputJsonObject),
        // Mirror the catalog connection type; starts NOT_CONNECTED (default).
        connectionType: def.connection.type,
        enabled: true,
      },
    });
    return toInstalledSkillDto(row);
  }
```

with:

```typescript
  async install(
    companyId: string,
    dto: InstallSkillDto,
  ): Promise<InstalledSkillDto> {
    const def = SkillCatalog.get(dto.skillKey);
    if (!def) {
      throw new NotFoundException(`Unknown skill: ${dto.skillKey}`);
    }
    const employeeId = dto.employeeId ?? null;
    let employeeName: string | null = null;
    if (employeeId) {
      const employee = await this.prisma.aiEmployee.findFirst({
        where: { id: employeeId, companyId },
        select: { name: true },
      });
      if (!employee) {
        throw new NotFoundException('Employee not found');
      }
      employeeName = employee.name;
    }
    const existing = await this.prisma.installedSkill.findUnique({
      where: {
        companyId_skillKey_employeeId: {
          companyId,
          skillKey: dto.skillKey,
          employeeId,
        },
      },
    });
    if (existing) {
      throw new ConflictException('Skill is already installed');
    }
    // Transactional: an employee-owned connection is auto-assigned to that same
    // employee (there's exactly one sensible owner, so a separate manual
    // "assign" step would be pure friction) — both writes commit together.
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.installedSkill.create({
        data: {
          companyId,
          skillKey: dto.skillKey,
          employeeId,
          displayName:
            dto.displayName?.trim() ||
            (employeeName ? `${def.name} — ${employeeName}` : def.name),
          config:
            dto.config === undefined
              ? undefined
              : (dto.config as Prisma.InputJsonObject),
          // Mirror the catalog connection type; starts NOT_CONNECTED (default).
          connectionType: def.connection.type,
          enabled: true,
        },
      });
      if (employeeId) {
        await tx.employeeSkill.create({
          data: { companyId, employeeId, installedSkillId: created.id },
        });
      }
      return created;
    });
    return toInstalledSkillDto(row);
  }
```

- [ ] **Step 4: Prefer an employee's own connection at execution time, fall back to company-wide**

In the same file, replace:

```typescript
  private async resolveExecutorContext(
    ctx: ExecutorContext,
    skillKey: string,
  ): Promise<ExecutorContext> {
    const installed = await this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey: { companyId: ctx.companyId, skillKey } },
    });
    if (!installed) {
      return ctx;
    }
```

with:

```typescript
  private async resolveExecutorContext(
    ctx: ExecutorContext,
    skillKey: string,
  ): Promise<ExecutorContext> {
    const installed = await this.resolveInstalledForExecution(
      ctx.companyId,
      ctx.employeeId,
      skillKey,
    );
    if (!installed) {
      return ctx;
    }
```

Then add a new private method right after `resolveExecutorContext` ends (immediately before its closing
`}` and the next method, `recordEgressHealth`):

```typescript
  /**
   * Prefer the acting employee's OWN connection for this skill (e.g. its own
   * Gmail mailbox) when one exists; otherwise fall back to the company-wide
   * connection (employeeId: null) — today's exact behavior when no
   * employee-owned connection has ever been created.
   */
  private async resolveInstalledForExecution(
    companyId: string,
    employeeId: string | null | undefined,
    skillKey: string,
  ): Promise<InstalledSkill | null> {
    if (employeeId) {
      const own = await this.prisma.installedSkill.findUnique({
        where: {
          companyId_skillKey_employeeId: { companyId, skillKey, employeeId },
        },
      });
      if (own) {
        return own;
      }
    }
    return this.prisma.installedSkill.findUnique({
      where: {
        companyId_skillKey_employeeId: {
          companyId,
          skillKey,
          employeeId: null,
        },
      },
    });
  }
```

- [ ] **Step 5: Fix the 3 other call sites broken by the widened compound key**

These are pure mechanical, behavior-preserving fixes — none of these 3 call sites are employee-context-
aware, and none becomes so; `employeeId: null` reproduces exactly what the old 2-field compound key
already matched (these lookups have only ever found company-wide connections).

In `apps/api/src/modules/scheduling/scheduling.service.ts`, change:

```typescript
  private async getCalendarAccessToken(companyId: string): Promise<string> {
    const installed = await this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey: { companyId, skillKey: 'calendar' } },
    });
    if (!installed || installed.connectionStatus !== 'CONNECTED') return '';
    const creds = readCredentials(this.crypto, installed.credentials);
    return credString(creds, 'accessToken', 'access_token');
  }

  private async getCalendarSettings(
    companyId: string,
  ): Promise<{ calendarId?: string; timezone?: string }> {
    const installed = await this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey: { companyId, skillKey: 'calendar' } },
    });
```

to:

```typescript
  private async getCalendarAccessToken(companyId: string): Promise<string> {
    const installed = await this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey_employeeId: { companyId, skillKey: 'calendar', employeeId: null } },
    });
    if (!installed || installed.connectionStatus !== 'CONNECTED') return '';
    const creds = readCredentials(this.crypto, installed.credentials);
    return credString(creds, 'accessToken', 'access_token');
  }

  private async getCalendarSettings(
    companyId: string,
  ): Promise<{ calendarId?: string; timezone?: string }> {
    const installed = await this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey_employeeId: { companyId, skillKey: 'calendar', employeeId: null } },
    });
```

In `apps/api/src/modules/workflows/engine/workflow-engine.service.ts`, change:

```typescript
    if (skillKey) {
      const connector = await this.prisma.installedSkill.findUnique({
        where: { companyId_skillKey: { companyId, skillKey } },
        select: { connectionStatus: true },
      });
```

to:

```typescript
    if (skillKey) {
      const connector = await this.prisma.installedSkill.findUnique({
        where: { companyId_skillKey_employeeId: { companyId, skillKey, employeeId: null } },
        select: { connectionStatus: true },
      });
```

In `apps/api/src/modules/skills/connectors/connector-health.service.ts`, change:

```typescript
  private byKey(
    companyId: string,
    skillKey: string,
  ): Promise<InstalledSkill | null> {
    return this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey: { companyId, skillKey } },
    });
  }
```

to:

```typescript
  private byKey(
    companyId: string,
    skillKey: string,
  ): Promise<InstalledSkill | null> {
    return this.prisma.installedSkill.findUnique({
      where: { companyId_skillKey_employeeId: { companyId, skillKey, employeeId: null } },
    });
  }
```

- [ ] **Step 6: Add e2e coverage**

In `apps/api/test/skills.e2e-spec.ts`, add these tests at the end of the `describeIfDb` block (after its
last existing test) — each is self-contained (creates its own employee) rather than depending on the
file's shared mutable state:

```typescript
  it('installs a skill owned by a specific employee, auto-assigning it', async () => {
    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'HR AI', role: 'HR', persona: 'HR assistant.' })
      .expect(201);
    const hrEmployeeId = emp.body.id;

    const res = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'gmail', employeeId: hrEmployeeId })
      .expect(201);
    expect(res.body.employeeId).toBe(hrEmployeeId);
    expect(res.body.displayName).toContain('HR AI');

    const assigned = await request(app.getHttpServer())
      .get(`/employees/${hrEmployeeId}/skills`)
      .set(auth())
      .expect(200);
    expect(
      assigned.body.some((a: { installedSkillId: string }) => a.installedSkillId === res.body.id),
    ).toBe(true);
  });

  it('allows a second, company-wide gmail connection alongside an employee-owned one', async () => {
    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'Support AI', role: 'SUPPORT', persona: 'Support assistant.' })
      .expect(201);
    const supportEmployeeId = emp.body.id;

    await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'gmail', employeeId: supportEmployeeId })
      .expect(201);

    // A second employee-owned gmail connection (different employee) must NOT
    // collide with the first — the unique constraint is (companyId, skillKey,
    // employeeId), not (companyId, skillKey).
    const list = await request(app.getHttpServer())
      .get('/skills/installed')
      .set(auth())
      .expect(200);
    const gmailRows = list.body.filter((s: { skillKey: string }) => s.skillKey === 'gmail');
    expect(gmailRows.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects installing the same skill for the same employee twice (409)', async () => {
    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'Sales AI', role: 'SALES', persona: 'Sales assistant.' })
      .expect(201);
    const salesEmployeeId = emp.body.id;

    await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'gmail', employeeId: salesEmployeeId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'gmail', employeeId: salesEmployeeId })
      .expect(409);
  });

  it('rejects installing a skill for an employee from a different company (404)', async () => {
    const otherCompany = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        companyName: 'Other Co',
        name: 'Other Owner',
        email: `other_${Date.now()}@example.com`,
        password: 'password123',
      })
      .expect(201);
    const otherEmployee = await request(app.getHttpServer())
      .post('/employees')
      .set({ Authorization: `Bearer ${otherCompany.body.tokens.accessToken}` })
      .send({ name: 'Other Employee', role: 'SUPPORT', persona: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'gmail', employeeId: otherEmployee.body.id })
      .expect(404);
  });
```

- [ ] **Step 7: Run the e2e suites and typecheck**

```bash
DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public REDIS_URL=redis://127.0.0.1:6380 \
LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local JWT_ACCESS_SECRET=test JWT_REFRESH_SECRET=test \
npx jest --config ./test/jest-e2e.json skills.e2e-spec.ts connector-health.e2e-spec.ts integrations.e2e-spec.ts
```

from `apps/api` — `connector-health.e2e-spec.ts` and `integrations.e2e-spec.ts` (which covers the
scheduling/calendar path) are regression checks for Step 5's 3 mechanical fixes, not new coverage. Expect
all `skills.e2e-spec.ts`/`connector-health.e2e-spec.ts` tests to pass; `integrations.e2e-spec.ts` has ONE
pre-existing, already-documented unrelated failure in this local environment (its OAuth-UNCONFIGURED test,
because `apps/api/.env` has real `OAUTH_GOOGLE_CLIENT_ID/SECRET` set locally — see `platform/CLAUDE.md`) —
confirm that failure is the SAME one that exists on `main` before this task's changes (e.g. via a quick
`git stash` + re-run if there's any doubt), not a new one you introduced.

Then:

```bash
pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json
```

Expected: clean, zero errors — this confirms all 6 call sites (not just the 2 in `skills.service.ts`) are
fixed.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/skills/skills.service.ts apps/api/src/modules/skills/dto/install-skill.dto.ts apps/api/src/modules/skills/skills.mapper.ts apps/api/src/modules/scheduling/scheduling.service.ts apps/api/src/modules/workflows/engine/workflow-engine.service.ts apps/api/src/modules/skills/connectors/connector-health.service.ts apps/api/test/skills.e2e-spec.ts
git commit -m "feat: employee-owned skill connections (install + execution-time resolution)"
```

---

### Task 4: `WorkflowsService.fireEvent` — connector-scoped routing

**Files:**
- Modify: `apps/api/src/modules/workflows/workflows.service.ts`
- Modify: `apps/api/src/modules/workflows/dto/fire-event.dto.ts`
- Modify: `apps/api/src/modules/workflows/workflows.controller.ts`
- Modify: `apps/api/test/workflow-conditions.e2e-spec.ts`

**Interfaces:**
- Consumes: `TriggerConfig.connectorId`, `fireEventSchema.connectorId` (Task 2).
- Produces: `fireEvent(companyId, eventType, payload?, connectorId?)` — Task 5 (Gmail inbound driver) passes
  the 4th argument; `POST /workflows/events`'s body now also accepts `connectorId` (verified against the
  actual current route at `apps/api/src/modules/workflows/workflows.controller.ts:64-71`, which calls
  `this.workflows.fireEvent(companyId, dto.eventType, dto.payload)` today).

- [ ] **Step 1: Add the `connectorId` parameter and filter**

In `apps/api/src/modules/workflows/workflows.service.ts`, replace:

```typescript
  async fireEvent(
    companyId: string,
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<FireEventResultDto> {
    const workflows = await this.prisma.workflow.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        triggerType: 'EVENT',
        triggerConfig: { path: ['eventType'], equals: eventType },
      },
    });

    const safePayload = payload ?? {};
    const eventId =
      typeof safePayload.eventId === 'string' ? safePayload.eventId : null;

    const runIds: string[] = [];
    for (const wf of workflows) {
      // Richer EVENT filtering: a workflow fires only if ALL its conditions pass
      // (empty/absent → always fire, so existing EVENT workflows are unaffected).
      const conditions = this.extractConditions(wf.triggerConfig);
      if (!evaluateConditions(conditions, safePayload)) {
        continue;
      }
      const run = await this.enqueueRun(wf.companyId, wf.id, 'EVENT', payload, {
        triggerEventId: eventId,
        // undefined → enqueueRun generates one (manual fire with no eventId).
        correlationId: eventId ?? undefined,
      });
      runIds.push(run.id);
    }
    return { eventType, count: runIds.length, runIds };
  }
```

with:

```typescript
  async fireEvent(
    companyId: string,
    eventType: string,
    payload?: Record<string, unknown>,
    connectorId?: string,
  ): Promise<FireEventResultDto> {
    const workflows = await this.prisma.workflow.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        triggerType: 'EVENT',
        triggerConfig: { path: ['eventType'], equals: eventType },
      },
    });

    const safePayload = payload ?? {};
    const eventId =
      typeof safePayload.eventId === 'string' ? safePayload.eventId : null;

    const runIds: string[] = [];
    for (const wf of workflows) {
      // Connector-scoped triggers (per-employee skill connections) only fire for
      // events from THEIR OWN connector; a trigger with no connectorId keeps
      // matching every connector of this eventType — today's exact behavior.
      const cfg = (wf.triggerConfig ?? null) as TriggerConfig | null;
      if (cfg?.connectorId && cfg.connectorId !== connectorId) {
        continue;
      }
      // Richer EVENT filtering: a workflow fires only if ALL its conditions pass
      // (empty/absent → always fire, so existing EVENT workflows are unaffected).
      const conditions = this.extractConditions(wf.triggerConfig);
      if (!evaluateConditions(conditions, safePayload)) {
        continue;
      }
      const run = await this.enqueueRun(wf.companyId, wf.id, 'EVENT', payload, {
        triggerEventId: eventId,
        // undefined → enqueueRun generates one (manual fire with no eventId).
        correlationId: eventId ?? undefined,
      });
      runIds.push(run.id);
    }
    return { eventType, count: runIds.length, runIds };
  }
```

- [ ] **Step 2: Thread `connectorId` through the manual fire-event HTTP route**

In `apps/api/src/modules/workflows/dto/fire-event.dto.ts`, replace the full contents with:

```typescript
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { FireEventDto as IFireEventDto } from '@vaep/types';

/** POST /workflows/events body — fire an internal event to EVENT workflows. */
export class FireEventDto implements IFireEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  eventType!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MinLength(1)
  connectorId?: string;
}
```

In `apps/api/src/modules/workflows/workflows.controller.ts`, change:

```typescript
  @Post('events')
  @HttpCode(200)
  fireEvent(
    @CurrentTenant() companyId: string,
    @Body() dto: FireEventDto,
  ): Promise<FireEventResultDto> {
    return this.workflows.fireEvent(companyId, dto.eventType, dto.payload);
  }
```

to:

```typescript
  @Post('events')
  @HttpCode(200)
  fireEvent(
    @CurrentTenant() companyId: string,
    @Body() dto: FireEventDto,
  ): Promise<FireEventResultDto> {
    return this.workflows.fireEvent(companyId, dto.eventType, dto.payload, dto.connectorId);
  }
```

- [ ] **Step 3: Add e2e coverage for connector-scoped routing**

In `apps/api/test/workflow-conditions.e2e-spec.ts`, add these tests at the end of its `describeIfDb`
block. They use the real route, `POST /workflows/events` with body `{eventType, payload, connectorId}`
(verified against the actual controller above — not a placeholder route):

```typescript
  it('a workflow with triggerConfig.connectorId only fires for that connector', async () => {
    const wfA = await request(app.getHttpServer())
      .post('/workflows')
      .set(auth())
      .send({
        name: 'Connector-scoped A',
        definition: {
          nodes: [
            { id: 't', type: 'TRIGGER', config: {} },
            { id: 'n', type: 'NOTIFY', config: { message: 'A fired' } },
          ],
          edges: [{ from: 't', to: 'n' }],
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workflows/${wfA.body.id}`)
      .set(auth())
      .send({ triggerType: 'EVENT', triggerConfig: { eventType: 'CONNECTOR_TEST', connectorId: 'conn_A' } })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workflows/${wfA.body.id}/activate`)
      .set(auth())
      .expect(200);

    const wfB = await request(app.getHttpServer())
      .post('/workflows')
      .set(auth())
      .send({
        name: 'Connector-scoped B',
        definition: {
          nodes: [
            { id: 't', type: 'TRIGGER', config: {} },
            { id: 'n', type: 'NOTIFY', config: { message: 'B fired' } },
          ],
          edges: [{ from: 't', to: 'n' }],
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workflows/${wfB.body.id}`)
      .set(auth())
      .send({ triggerType: 'EVENT', triggerConfig: { eventType: 'CONNECTOR_TEST', connectorId: 'conn_B' } })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workflows/${wfB.body.id}/activate`)
      .set(auth())
      .expect(200);

    const fired = await request(app.getHttpServer())
      .post('/workflows/events')
      .set(auth())
      .send({ eventType: 'CONNECTOR_TEST', payload: {}, connectorId: 'conn_A' })
      .expect(200);

    expect(fired.body.runIds).toHaveLength(1);
    const run = await request(app.getHttpServer())
      .get(`/workflows/runs/${fired.body.runIds[0]}`)
      .set(auth())
      .expect(200);
    expect(run.body.workflowId).toBe(wfA.body.id);
  });

  it('a workflow with no connectorId still fires for any connector (regression check)', async () => {
    const wf = await request(app.getHttpServer())
      .post('/workflows')
      .set(auth())
      .send({
        name: 'Unscoped trigger',
        definition: {
          nodes: [
            { id: 't', type: 'TRIGGER', config: {} },
            { id: 'n', type: 'NOTIFY', config: { message: 'fired' } },
          ],
          edges: [{ from: 't', to: 'n' }],
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workflows/${wf.body.id}`)
      .set(auth())
      .send({ triggerType: 'EVENT', triggerConfig: { eventType: 'UNSCOPED_TEST' } })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workflows/${wf.body.id}/activate`)
      .set(auth())
      .expect(200);

    const fired = await request(app.getHttpServer())
      .post('/workflows/events')
      .set(auth())
      .send({ eventType: 'UNSCOPED_TEST', payload: {}, connectorId: 'any_connector_id' })
      .expect(200);

    expect(fired.body.runIds).toHaveLength(1);
  });
```

- [ ] **Step 4: Run the e2e suite and typecheck**

```bash
DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public REDIS_URL=redis://127.0.0.1:6380 \
LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local JWT_ACCESS_SECRET=test JWT_REFRESH_SECRET=test \
npx jest --config ./test/jest-e2e.json workflow-conditions.e2e-spec.ts
```

from `apps/api`, then `pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json`. Expected: all pass,
clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/workflows/workflows.service.ts apps/api/src/modules/workflows/dto/fire-event.dto.ts apps/api/src/modules/workflows/workflows.controller.ts apps/api/test/workflow-conditions.e2e-spec.ts
git commit -m "feat: connector-scoped EVENT triggers in WorkflowsService.fireEvent"
```

---

### Task 5: Gmail inbound driver — thread the firing connector's id

**Files:**
- Modify: `apps/api/src/modules/events/inbound/gmail-inbound.service.ts`

**Interfaces:**
- Consumes: `fireEvent(..., connectorId?)` (Task 4).

- [ ] **Step 1: Pass `connector.id` as the 4th argument**

In `apps/api/src/modules/events/inbound/gmail-inbound.service.ts`, change:

```typescript
        const result = await this.workflows.fireEvent(
          connector.companyId,
          eventType,
          {
            eventId: canonical.id,
            from: email.from ?? null,
            subject: email.subject ?? null,
            snippet: email.snippet ?? null,
            // FULL body now (was the snippet); falls back to snippet when a
            // metadata-only payload carried no parsed body (offline-safe).
            body: email.body ?? email.snippet ?? null,
            // Attachment (CV) text extracted from the email's PDF/text parts.
            cv: email.cv ?? null,
            // The ORIGINAL application's CV/subject (replies only) — see above.
            originalCv,
            originalSubject,
            attachments: email.attachments ?? [],
            messageId: email.messageId ?? null,
            // Precomputed "does this look like a job application" signal — a
            // workflow's own EVENT trigger conditions can opt into filtering
            // out spam/newsletters via this (docs/test-cases REC-07).
            looksLikeApplication: message.looksLikeApplication,
            isRepeatSender: priorSubmissionCount > 0,
            priorSubmissionCount,
            data: email,
          },
        );
```

to:

```typescript
        const result = await this.workflows.fireEvent(
          connector.companyId,
          eventType,
          {
            eventId: canonical.id,
            from: email.from ?? null,
            subject: email.subject ?? null,
            snippet: email.snippet ?? null,
            // FULL body now (was the snippet); falls back to snippet when a
            // metadata-only payload carried no parsed body (offline-safe).
            body: email.body ?? email.snippet ?? null,
            // Attachment (CV) text extracted from the email's PDF/text parts.
            cv: email.cv ?? null,
            // The ORIGINAL application's CV/subject (replies only) — see above.
            originalCv,
            originalSubject,
            attachments: email.attachments ?? [],
            messageId: email.messageId ?? null,
            // Precomputed "does this look like a job application" signal — a
            // workflow's own EVENT trigger conditions can opt into filtering
            // out spam/newsletters via this (docs/test-cases REC-07).
            looksLikeApplication: message.looksLikeApplication,
            isRepeatSender: priorSubmissionCount > 0,
            priorSubmissionCount,
            data: email,
          },
          // This mailbox's own connector id -- lets a workflow's EVENT trigger
          // scope itself to ONE specific mailbox via triggerConfig.connectorId
          // (per-employee skill connections), instead of firing for every
          // Gmail connector in the company.
          connector.id,
        );
```

- [ ] **Step 2: Typecheck and run the existing Gmail e2e coverage**

```bash
pnpm --filter @vaep/api exec tsc --noEmit -p tsconfig.json
```

Then run whatever existing e2e file(s) cover Gmail inbound processing (search `apps/api/test/` for
`gmail`) to confirm no regression — the change is purely additive (one new trailing argument), so existing
assertions about `firedRuns`/workflow counts should be unaffected.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/events/inbound/gmail-inbound.service.ts
git commit -m "feat: thread the firing Gmail connector's id into fireEvent"
```

---

### Task 6: Frontend — thread `employeeId` through install + `InstalledSkillDto`

**Files:**
- Modify: `apps/web/src/features/skills/hooks.ts`

**Interfaces:**
- Consumes: `InstalledSkillDto.employeeId`, `InstallSkillDto.employeeId` (Task 2, re-exported via
  `features/skills/schemas.ts` from `@vaep/types` already — no schema re-export file changes needed since
  that file already does `export type { ... } from '@vaep/types'` generically).
- Produces: `useInstallSkill()`'s optimistic object correctly typed with `employeeId` — Task 7 depends on
  calling `install.mutate({ skillKey, employeeId })` without a type error.

- [ ] **Step 1: Add `employeeId` to the optimistic install object**

In `apps/web/src/features/skills/hooks.ts`, change:

```typescript
      const optimistic: InstalledSkillDto = {
        id: `temp_${Date.now()}`,
        companyId: '',
        skillKey: payload.skillKey,
        displayName: payload.displayName ?? payload.skillKey,
        config: payload.config ?? null,
        enabled: true,
        connectionType: null,
        connectionStatus: 'NOT_CONNECTED',
        credentialsSet: false,
        createdAt: new Date().toISOString(),
      };
```

to:

```typescript
      const optimistic: InstalledSkillDto = {
        id: `temp_${Date.now()}`,
        companyId: '',
        skillKey: payload.skillKey,
        employeeId: payload.employeeId ?? null,
        displayName: payload.displayName ?? payload.skillKey,
        config: payload.config ?? null,
        enabled: true,
        connectionType: null,
        connectionStatus: 'NOT_CONNECTED',
        credentialsSet: false,
        createdAt: new Date().toISOString(),
      };
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @vaep/web exec tsc --noEmit
```

Expected: still fails in `EmployeeSkillPicker.tsx`/`TriggerPanel.tsx` if they reference `employeeId` before
Tasks 7/8 land (they don't yet at this point in the plan, so this should actually be clean already) —
confirm zero errors anywhere in `features/skills`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/skills/hooks.ts
git commit -m "feat: thread employeeId through the frontend install-skill hook"
```

---

### Task 7: Frontend — "Connect a skill for this employee" on the employee page

**Files:**
- Modify: `apps/web/src/features/skills/components/EmployeeSkillPicker.tsx`

**Interfaces:**
- Consumes: `useCatalog()`, `useInstalledSkills()`, `useInstallSkill()` (existing hooks, `employeeId` now
  supported per Task 6), `ConnectSkillControl` (existing, reused as-is).

- [ ] **Step 1: Add the connect-for-this-employee section**

Replace the full contents of `apps/web/src/features/skills/components/EmployeeSkillPicker.tsx` with:

```typescript
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ConnectSkillControl } from './ConnectSkillControl';
import {
  useAssignSkill,
  useCatalog,
  useEmployeeSkills,
  useInstalledSkills,
  useInstallSkill,
  useUnassignSkill,
} from '../hooks';

/**
 * Assign / unassign already-installed company skills to a specific employee
 * (optimistic), plus a section to give this employee its OWN connection of an
 * OAuth-capable skill (e.g. its own Gmail mailbox) — separate from any
 * company-wide connection managed on the global /skills page.
 */
export function EmployeeSkillPicker({ employeeId }: { employeeId: string }) {
  const { data: installed, isLoading } = useInstalledSkills();
  const { data: catalog } = useCatalog();
  const { data: assigned } = useEmployeeSkills(employeeId);
  const assign = useAssignSkill(employeeId);
  const unassign = useUnassignSkill(employeeId);
  const install = useInstallSkill();

  const assignedIds = new Set((assigned ?? []).map((a) => a.installedSkillId));
  const busy = assign.isPending || unassign.isPending;

  // OAuth-capable catalog skills this employee doesn't already own a connection for.
  const ownedSkillKeys = new Set(
    (installed ?? [])
      .filter((s) => s.employeeId === employeeId)
      .map((s) => s.skillKey),
  );
  const connectableForEmployee = (catalog ?? []).filter(
    (def) => def.connection?.type === 'oauth' && !ownedSkillKeys.has(def.key),
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Skills</h2>

        {isLoading ? (
          <p className="text-sm text-zinc-500">Loading skills…</p>
        ) : !installed || installed.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No skills installed.{' '}
            <Link href="/skills" className="font-medium text-violet-secondary hover:text-white">
              Install skills
            </Link>{' '}
            to assign them here.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {installed.map((skill) => {
              const isAssigned = assignedIds.has(skill.id);
              return (
                <li
                  key={skill.id}
                  className="flex items-center justify-between gap-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {skill.displayName}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {skill.skillKey}
                      {!skill.enabled && ' · disabled'}
                    </p>
                  </div>
                  {isAssigned ? (
                    <button
                      type="button"
                      onClick={() => unassign.mutate({ installedSkillId: skill.id })}
                      disabled={busy}
                      className="rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Unassign
                    </button>
                  ) : (
                    <Button
                      variant="violet"
                      onClick={() => assign.mutate({ installedSkillId: skill.id })}
                      disabled={busy}
                    >
                      Assign
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {connectableForEmployee.length > 0 && (
        <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <h2 className="mb-1 text-sm font-medium text-zinc-400">
            Connect a skill for this employee
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            Gives this employee its own connection (e.g. its own mailbox), separate
            from any company-wide connection on the Skills page.
          </p>
          <ul className="space-y-2">
            {connectableForEmployee.map((def) => {
              const ownRow = (installed ?? []).find(
                (s) => s.skillKey === def.key && s.employeeId === employeeId,
              );
              return (
                <li
                  key={def.key}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-sm text-zinc-300">{def.name}</span>
                  {ownRow ? (
                    <ConnectSkillControl installed={ownRow} def={def} />
                  ) : (
                    <Button
                      variant="violet"
                      onClick={() => install.mutate({ skillKey: def.key, employeeId })}
                      disabled={install.isPending}
                    >
                      {install.isPending ? 'Connecting…' : `Connect ${def.name}`}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @vaep/web exec tsc --noEmit
```

Expected: clean, zero errors.

- [ ] **Step 3: Manual verification**

Start the dev server if not already running (`pnpm dev` from `platform/`; check first via `netstat`/process
list before starting one yourself, and kill only an instance you started, per this project's standing
convention). Register a throwaway test company, hire an HR-role employee, open its page's "Tools" tab,
confirm the new "Connect a skill for this employee" section lists Gmail (and Slack, if its connection type
is also `oauth`) with a "Connect Gmail" button, click it, confirm it creates an owned connection and
renders the OAuth "Connect Gmail" button from `ConnectSkillControl` in its place. Kill any dev server you
started afterward.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/skills/components/EmployeeSkillPicker.tsx
git commit -m "feat: connect a skill just for one employee, from the employee page"
```

---

### Task 8: Frontend — connector-scoping dropdown on the EVENT trigger editor

**Files:**
- Modify: `apps/web/src/features/workflows/components/TriggerPanel.tsx`

**Interfaces:**
- Consumes: `useInstalledSkills()` (from `features/skills/hooks`, cross-feature import — already an
  established pattern in this codebase).

- [ ] **Step 1: Add the connector dropdown**

In `apps/web/src/features/workflows/components/TriggerPanel.tsx`, add the import:

```typescript
import { useState } from 'react';
import { X } from 'lucide-react';
import type {
  Condition,
  EventConditionOp,
  TriggerType,
  WorkflowDto,
} from '@vaep/types';
import { EVENT_CONDITION_OPS } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import {
  useActivateWorkflow,
  useDeactivateWorkflow,
  useUpdateWorkflow,
} from '../hooks';
```

becomes:

```typescript
import { useState } from 'react';
import { X } from 'lucide-react';
import type {
  Condition,
  EventConditionOp,
  TriggerType,
  WorkflowDto,
} from '@vaep/types';
import { EVENT_CONDITION_OPS } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useInstalledSkills } from '@/features/skills/hooks';
import {
  useActivateWorkflow,
  useDeactivateWorkflow,
  useUpdateWorkflow,
} from '../hooks';
```

Inside the component, add state and the connector list, right after the existing `conditions` state:

```typescript
  const [conditions, setConditions] = useState<ConditionRow[]>(() =>
    initialConditions(workflow),
  );
  const [copied, setCopied] = useState(false);
```

becomes:

```typescript
  const [conditions, setConditions] = useState<ConditionRow[]>(() =>
    initialConditions(workflow),
  );
  const [connectorId, setConnectorId] = useState<string>(
    workflow.triggerConfig?.connectorId ?? '',
  );
  const [copied, setCopied] = useState(false);

  const { data: installedSkills } = useInstalledSkills();
  // Only Gmail connections can currently receive inbound events -- this list
  // grows the same way if/when other providers get an inbound driver.
  const connectableMailboxes = (installedSkills ?? []).filter(
    (s) => s.skillKey === 'gmail' && s.connectionStatus === 'CONNECTED',
  );
```

Update `onSaveTrigger`'s EVENT branch — change:

```typescript
    } else if (triggerType === 'EVENT') {
      const built = buildConditions(conditions);
      triggerConfig = {
        eventType: eventType.trim(),
        ...(built.length > 0 ? { conditions: built } : {}),
      };
    } else {
```

to:

```typescript
    } else if (triggerType === 'EVENT') {
      const built = buildConditions(conditions);
      triggerConfig = {
        eventType: eventType.trim(),
        ...(built.length > 0 ? { conditions: built } : {}),
        ...(connectorId ? { connectorId } : {}),
      };
    } else {
```

Add the dropdown in the JSX, right after the "Event type" `<input>` and before the "Conditions" block —
change:

```typescript
      {triggerType === 'EVENT' && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Event type
          </label>
          <input
            type="text"
            placeholder="e.g. NEW_PAYMENT"
            className="field-modern font-mono text-sm"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />

          <div className="mt-3">
```

to:

```typescript
      {triggerType === 'EVENT' && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Event type
          </label>
          <input
            type="text"
            placeholder="e.g. NEW_PAYMENT"
            className="field-modern font-mono text-sm"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />

          {connectableMailboxes.length > 0 && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Only for this connected mailbox
              </label>
              <select
                className="field-modern text-sm"
                value={connectorId}
                onChange={(e) => setConnectorId(e.target.value)}
              >
                <option value="">Any connected mailbox</option>
                {connectableMailboxes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3">
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @vaep/web exec tsc --noEmit
```

Expected: clean, zero errors.

- [ ] **Step 3: Manual verification**

With the same throwaway company from Task 7 (HR AI's Gmail connected), open a workflow, set its trigger to
Event, confirm the new "Only for this connected mailbox" dropdown appears and lists the HR AI's Gmail
connection by its display name, select it, Save, and confirm (via the workflow's own GET response) that
`triggerConfig.connectorId` was persisted.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/workflows/components/TriggerPanel.tsx
git commit -m "feat: connector-scoping dropdown on the EVENT trigger editor"
```

---

### Task 9: End-to-end proof — two mailboxes, correct routing

**Files:**
- Create: `apps/api/test/per-employee-skill-connections.e2e-spec.ts`

**Interfaces:**
- Consumes everything from Tasks 1-5 together, end to end.

- [ ] **Step 1: Write the full-flow e2e test**

Create `apps/api/test/per-employee-skill-connections.e2e-spec.ts`:

```typescript
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Needs a live Postgres + Redis, same convention as skills.e2e-spec.ts.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Per-employee skill connections e2e (two mailboxes, correct routing)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `per_employee_skill_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  const auth: Record<string, string> = {};
  let companyId = '';
  let hrEmployeeId = '';
  let hrConnectorId = '';
  let hrWorkflowId = '';
  let companyWideConnectorId = '';
  let companyWideWorkflowId = '';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'Per-Employee Skill E2E Co', name: 'Owner', email, password })
      .expect(201);
    auth.Authorization = `Bearer ${res.body.tokens.accessToken}`;
    companyId = res.body.company.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sets up an HR-owned Gmail connection and a company-wide Gmail connection', async () => {
    const hr = await request(app.getHttpServer())
      .post('/employees')
      .set(auth)
      .send({ name: 'HR AI', role: 'HR', persona: 'HR assistant.' })
      .expect(201);
    hrEmployeeId = hr.body.id;

    const hrInstall = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth)
      .send({ skillKey: 'gmail', employeeId: hrEmployeeId })
      .expect(201);
    hrConnectorId = hrInstall.body.id;

    const companyInstall = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth)
      .send({ skillKey: 'gmail' })
      .expect(201);
    companyWideConnectorId = companyInstall.body.id;

    expect(hrConnectorId).not.toBe(companyWideConnectorId);
  });

  it('creates one workflow scoped to the HR connector and one scoped to the company-wide connector', async () => {
    const hrWf = await request(app.getHttpServer())
      .post('/workflows')
      .set(auth)
      .send({
        name: 'HR mailbox workflow',
        definition: {
          nodes: [
            { id: 't', type: 'TRIGGER', config: {} },
            { id: 'n', type: 'NOTIFY', config: { message: 'HR mail arrived' } },
          ],
          edges: [{ from: 't', to: 'n' }],
        },
      })
      .expect(201);
    hrWorkflowId = hrWf.body.id;
    await request(app.getHttpServer())
      .patch(`/workflows/${hrWorkflowId}`)
      .set(auth)
      .send({
        triggerType: 'EVENT',
        triggerConfig: { eventType: 'NEW_EMAIL', connectorId: hrConnectorId },
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workflows/${hrWorkflowId}/activate`)
      .set(auth)
      .expect(200);

    const companyWf = await request(app.getHttpServer())
      .post('/workflows')
      .set(auth)
      .send({
        name: 'Company-wide mailbox workflow',
        definition: {
          nodes: [
            { id: 't', type: 'TRIGGER', config: {} },
            { id: 'n', type: 'NOTIFY', config: { message: 'company mail arrived' } },
          ],
          edges: [{ from: 't', to: 'n' }],
        },
      })
      .expect(201);
    companyWideWorkflowId = companyWf.body.id;
    await request(app.getHttpServer())
      .patch(`/workflows/${companyWideWorkflowId}`)
      .set(auth)
      .send({
        triggerType: 'EVENT',
        triggerConfig: { eventType: 'NEW_EMAIL', connectorId: companyWideConnectorId },
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workflows/${companyWideWorkflowId}/activate`)
      .set(auth)
      .expect(200);
  });

  it('an event from the HR connector fires only the HR-scoped workflow', async () => {
    const fired = await request(app.getHttpServer())
      .post('/workflows/events')
      .set(auth)
      .send({ eventType: 'NEW_EMAIL', payload: { eventId: 'evt_hr_1' }, connectorId: hrConnectorId })
      .expect(200);
    expect(fired.body.runIds).toHaveLength(1);
    const run = await prisma.workflowRun.findUnique({ where: { id: fired.body.runIds[0] } });
    expect(run?.workflowId).toBe(hrWorkflowId);
  });

  it('an event from the company-wide connector fires only the company-wide-scoped workflow', async () => {
    const fired = await request(app.getHttpServer())
      .post('/workflows/events')
      .set(auth)
      .send({ eventType: 'NEW_EMAIL', payload: { eventId: 'evt_co_1' }, connectorId: companyWideConnectorId })
      .expect(200);
    expect(fired.body.runIds).toHaveLength(1);
    const run = await prisma.workflowRun.findUnique({ where: { id: fired.body.runIds[0] } });
    expect(run?.workflowId).toBe(companyWideWorkflowId);
  });
});
```

Note: this uses the real `POST /workflows/events` route (verified in Task 4 against the actual controller)
with a `connectorId` in the body, rather than firing a live Gmail-sourced event end-to-end (which would
require real Gmail API access) — it exercises the exact same `fireEvent` code path Task 5's Gmail driver
calls, with the same argument shape, which is what this task is verifying.

- [ ] **Step 2: Run it**

```bash
DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public REDIS_URL=redis://127.0.0.1:6380 \
LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local JWT_ACCESS_SECRET=test JWT_REFRESH_SECRET=test \
npx jest --config ./test/jest-e2e.json per-employee-skill-connections.e2e-spec.ts
```

from `apps/api`. Expected: all 4 tests pass.

- [ ] **Step 3: Run the FULL e2e suite once to confirm no regressions anywhere**

```bash
DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public REDIS_URL=redis://127.0.0.1:6380 \
LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local JWT_ACCESS_SECRET=test JWT_REFRESH_SECRET=test \
npx jest --config ./test/jest-e2e.json
```

from `apps/api`. Expected: same pass/fail counts as the pre-existing baseline (only the 2 pre-existing,
already-documented unrelated failures — `integrations.e2e-spec.ts`'s OAuth-UNCONFIGURED test and
`knowledge.e2e-spec.ts`'s search-score-variance test — should differ from a clean baseline; every other
suite, including all Tasks 1-9 additions, passes).

- [ ] **Step 4: Update `platform/CLAUDE.md`'s Skills module bullet**

Add one line noting per-employee skill connections are live, mirroring how prior features documented
themselves there.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/per-employee-skill-connections.e2e-spec.ts platform/CLAUDE.md
git commit -m "test: end-to-end proof that per-employee connectors route to the right workflow"
```
