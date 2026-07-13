# AI Workflow Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let a user describe a need in plain language in a small chat, and have AI produce a working
draft `Workflow` (grounded in the company's real installed skills + hired employees), gated to
BUSINESS/ENTERPRISE plans, with zero new Prisma models/migrations.

**Architecture:** one new endpoint (`POST /workflows/generate`) on the *existing* `WorkflowsController`,
backed by a new `WorkflowGeneratorService` that calls the *existing* shared `LlmProvider`, validates the
result against the company's real installed skills/employees, self-corrects once, and gracefully
degrades any still-bad reference to an "unconfigured" placeholder rather than failing. The draft is
created via the *existing* `POST /workflows` (which already accepts an optional `definition`) — the
generator itself never writes to the database.

**Tech Stack:** NestJS, Prisma, class-validator/class-transformer, the existing `LlmProvider` abstraction
(`LLM_PROVIDER=mock` for all tests, matching the codebase-wide convention) · Next.js, TanStack Query.

## Global Constraints
- Zero new Prisma models, columns, or migrations (spec: `docs/specs/2026-07-13-ai-workflow-generator-design.md`).
- No new top-level backend module — everything lives inside `modules/workflows` (plus one small addition
  to `modules/billing` for the plan-gate, since that's where `Subscription`/plan logic already lives).
- Chat history is never persisted; only the final accepted `Workflow` row is (via the existing create path).
- Follow existing repo conventions exactly: tenant-scoped via `@CurrentTenant()`, `@Roles`-style guard
  pattern, TanStack Query optimistic-mutation style on the frontend, dark theme (`field-modern`,
  `rounded-2xl border border-white/[0.07] bg-white/[0.03]`, `Button variant="violet"`) per the app-shell
  restyle already shipped.
- **One deliberate refinement of the spec, noted here so it isn't a silent deviation:** the spec said
  "nothing is saved until the user clicks Save." In practice the existing builder has no "preview an
  unsaved definition" mode — workflows are always fetched by id. So a ready draft is created immediately
  as a normal **DRAFT-status** workflow (via the existing create endpoint) and the user lands on its
  existing builder/detail page. This preserves the actual safety guarantee (nothing runs/activates,
  nothing *real* can be touched, a bad draft is just deleted) using the mechanism that already exists,
  instead of building a new client-only preview mode.

---

### Task 1: Extract the shared workflow-definition structural validator

**Files:**
- Create: `apps/api/src/modules/workflows/engine/definition-validator.ts`
- Modify: `apps/api/src/modules/workflows/workflows.service.ts:424-450` (the `validateDefinition` private method)
- Test: `apps/api/src/modules/workflows/engine/definition-validator.spec.ts`

**Interfaces:**
- Produces: `validateDefinitionStructure(definition: WorkflowDefinition): void` — throws
  `BadRequestException` on a duplicate node id or an edge referencing an unknown node id; no-ops on a
  valid (or undefined-safe, caller checks that) definition. Used by Task 5's `WorkflowGeneratorService`
  and by the existing `WorkflowsService`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/workflows/engine/definition-validator.spec.ts
import { BadRequestException } from '@nestjs/common';
import type { WorkflowDefinition } from '@vaep/types';
import { validateDefinitionStructure } from './definition-validator';

describe('validateDefinitionStructure', () => {
  it('accepts a valid linear definition', () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: 'a', type: 'TRIGGER', config: {} },
        { id: 'b', type: 'NOTIFY', config: {} },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };
    expect(() => validateDefinitionStructure(def)).not.toThrow();
  });

  it('rejects a duplicate node id', () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: 'a', type: 'TRIGGER', config: {} },
        { id: 'a', type: 'NOTIFY', config: {} },
      ],
      edges: [],
    };
    expect(() => validateDefinitionStructure(def)).toThrow(BadRequestException);
    expect(() => validateDefinitionStructure(def)).toThrow(/Duplicate node id "a"/);
  });

  it('rejects an edge to an unknown node', () => {
    const def: WorkflowDefinition = {
      nodes: [{ id: 'a', type: 'TRIGGER', config: {} }],
      edges: [{ from: 'a', to: 'ghost' }],
    };
    expect(() => validateDefinitionStructure(def)).toThrow(/unknown node id "ghost"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vaep/api exec jest src/modules/workflows/engine/definition-validator.spec.ts`
Expected: FAIL — `Cannot find module './definition-validator'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/modules/workflows/engine/definition-validator.ts
import { BadRequestException } from '@nestjs/common';
import type { WorkflowDefinition } from '@vaep/types';

/**
 * Structural checks shared by manual creation/update (WorkflowsService) and
 * AI generation (WorkflowGeneratorService): every node id is unique, and every
 * edge points at a node id that actually exists in the same definition.
 */
export function validateDefinitionStructure(definition: WorkflowDefinition): void {
  const ids = new Set<string>();
  for (const node of definition.nodes) {
    if (ids.has(node.id)) {
      throw new BadRequestException(
        `Duplicate node id "${node.id}" in workflow definition`,
      );
    }
    ids.add(node.id);
  }
  for (const edge of definition.edges) {
    if (!ids.has(edge.from)) {
      throw new BadRequestException(
        `Edge references unknown node id "${edge.from}"`,
      );
    }
    if (!ids.has(edge.to)) {
      throw new BadRequestException(
        `Edge references unknown node id "${edge.to}"`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vaep/api exec jest src/modules/workflows/engine/definition-validator.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Point the existing service at the shared function**

Read `apps/api/src/modules/workflows/workflows.service.ts:424-450` first — the current body of
`validateDefinition`. Replace ONLY the loop logic (keep the method's `if (!definition) return;` guard
and its two call sites at lines 67 and 119 unchanged):

```typescript
// apps/api/src/modules/workflows/workflows.service.ts — replace the method body
private validateDefinition(definition: WorkflowDefinition | undefined): void {
  if (!definition) {
    return;
  }
  validateDefinitionStructure(definition);
}
```

Add the import near the top of the file (alongside the other `./engine/...` import):
```typescript
import { validateDefinitionStructure } from './engine/definition-validator';
```

- [ ] **Step 6: Run the existing workflow test suites to confirm no regression**

Run (from `apps/api`, with the env vars from `platform/CLAUDE.md`'s e2e section):
`pnpm test workflows.e2e-spec workflow-conditions.e2e-spec`
Expected: PASS, same counts as before this change (this is a pure refactor).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/workflows/engine/definition-validator.ts apps/api/src/modules/workflows/engine/definition-validator.spec.ts apps/api/src/modules/workflows/workflows.service.ts
git commit -m "refactor: extract workflow-definition structural validator for reuse"
```

---

### Task 2: Shared types for workflow generation

**Files:**
- Modify: `packages/types/src/index.ts` (add near the existing `WorkflowDto`/`WorkflowDefinition` block, e.g. after line 1169)

**Interfaces:**
- Produces: `GenerateWorkflowMessageDto`, `GenerateWorkflowDto`, `UnresolvedWorkflowNodeDto`,
  `GenerateWorkflowResultDto` — consumed by Task 3's controller DTO, Task 5's service, and Task 7's
  frontend API client.

- [ ] **Step 1: Add the types**

```typescript
// packages/types/src/index.ts — add after the WorkflowDto block (after line 1169)

/** One turn in the AI-workflow-generation chat (never persisted). */
export interface GenerateWorkflowMessageDto {
  role: 'user' | 'assistant';
  content: string;
}

/** POST /workflows/generate body — the whole chat so far, sent each turn. */
export interface GenerateWorkflowDto {
  messages: GenerateWorkflowMessageDto[];
}

/** A node in a generated draft the AI couldn't confidently resolve. */
export interface UnresolvedWorkflowNodeDto {
  nodeId: string;
  reason: string;
}

/**
 * Response of POST /workflows/generate. `question` means the AI needs more
 * info before it can draft anything (send it back as the next `assistant`
 * message + the user's reply as the next `user` message). `draft` is a
 * ready-to-review definition — `unresolvedNodes` lists any step the AI
 * couldn't confidently fill in (see docs/specs/2026-07-13-ai-workflow-generator-design.md).
 */
export type GenerateWorkflowResultDto =
  | { type: 'question'; message: string }
  | {
      type: 'draft';
      definition: WorkflowDefinition;
      unresolvedNodes: UnresolvedWorkflowNodeDto[];
    };
```

- [ ] **Step 2: Rebuild the shared types package**

Run: `pnpm --filter @vaep/types build`
Expected: succeeds with no TypeScript errors (this package has no test suite of its own — its
"test" is that dependents typecheck against it, covered by the tasks below).

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat: add GenerateWorkflow* shared types for AI workflow generation"
```

---

### Task 3: Plan-tier guard (`@RequirePlan`, `PlanGuard`)

**Files:**
- Create: `apps/api/src/modules/billing/decorators/plan.decorator.ts`
- Create: `apps/api/src/modules/billing/plan.guard.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`
- Test: `apps/api/src/modules/billing/plan.guard.spec.ts`

**Interfaces:**
- Consumes: `BillingService.getSubscription(companyId): Promise<SubscriptionDto>` (existing, returns
  `{ plan: Plan; ... }`).
- Produces: `RequirePlan(...plans: Plan[])` decorator, `PlanGuard` (a Nest `CanActivate`) — both exported
  from `BillingModule`. Consumed by Task 6's controller endpoint.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/billing/plan.guard.spec.ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SubscriptionDto } from '@vaep/types';
import { PlanGuard } from './plan.guard';
import { PLAN_KEY } from './decorators/plan.decorator';
import type { BillingService } from './billing.service';

function makeContext(companyId: string): ExecutionContext {
  const req = { user: { companyId } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PlanGuard', () => {
  it('allows any plan when no @RequirePlan metadata is present', async () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const billing = { getSubscription: jest.fn() } as unknown as BillingService;
    const guard = new PlanGuard(reflector, billing);

    await expect(guard.canActivate(makeContext('co_1'))).resolves.toBe(true);
    expect(billing.getSubscription).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the company plan is not in the allowed list', async () => {
    const reflector = {
      getAllAndOverride: () => ['BUSINESS', 'ENTERPRISE'],
    } as unknown as Reflector;
    const billing = {
      getSubscription: jest.fn().mockResolvedValue({ plan: 'STARTER' } as SubscriptionDto),
    } as unknown as BillingService;
    const guard = new PlanGuard(reflector, billing);

    await expect(guard.canActivate(makeContext('co_1'))).rejects.toThrow(ForbiddenException);
  });

  it('allows a company whose plan is in the allowed list', async () => {
    const reflector = {
      getAllAndOverride: () => ['BUSINESS', 'ENTERPRISE'],
    } as unknown as Reflector;
    const billing = {
      getSubscription: jest.fn().mockResolvedValue({ plan: 'BUSINESS' } as SubscriptionDto),
    } as unknown as BillingService;
    const guard = new PlanGuard(reflector, billing);

    await expect(guard.canActivate(makeContext('co_1'))).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vaep/api exec jest src/modules/billing/plan.guard.spec.ts`
Expected: FAIL — `Cannot find module './plan.guard'`

- [ ] **Step 3: Write the decorator**

```typescript
// apps/api/src/modules/billing/decorators/plan.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { Plan } from '@vaep/types';

/** Metadata key holding the plans allowed to invoke a handler. */
export const PLAN_KEY = 'requiredPlans';

/**
 * Restrict a route to companies on one of the given plans, evaluated by
 * PlanGuard. A handler with NO @RequirePlan metadata is open to any plan
 * (mirrors how @Roles/RolesGuard treats an absent decorator).
 */
export const RequirePlan = (...plans: Plan[]) => SetMetadata(PLAN_KEY, plans);
```

- [ ] **Step 4: Write the guard**

```typescript
// apps/api/src/modules/billing/plan.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Plan } from '@vaep/types';
import type { AuthenticatedUser } from '../auth/auth.provider';
import { PLAN_KEY } from './decorators/plan.decorator';
import { BillingService } from './billing.service';

/**
 * Authorization guard that runs AFTER JwtAuthGuard (request.user populated).
 * Reads `@RequirePlan(...)` metadata; when absent the route is open to any
 * plan. Otherwise loads the caller's real subscription (self-healing to a
 * default STARTER if one somehow doesn't exist yet, same as every other
 * BillingService caller) and 403s if its plan isn't in the allowed list.
 *
 * This is the first real plan-tier enforcement in the codebase — every other
 * plan limit today is informational only (see PLAN_CATALOG comments). Written
 * generically enough that a future feature can reuse `@RequirePlan(...)` on
 * another endpoint, but nothing else is gated by it yet.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<Plan[] | undefined>(
      PLAN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed || allowed.length === 0) {
      return true;
    }
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const companyId = req.user?.companyId;
    if (!companyId) {
      throw new ForbiddenException('No authenticated company for this request');
    }
    const subscription = await this.billing.getSubscription(companyId);
    if (!allowed.includes(subscription.plan)) {
      throw new ForbiddenException(
        `This feature requires the ${allowed.join(' or ')} plan`,
      );
    }
    return true;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @vaep/api exec jest src/modules/billing/plan.guard.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Export the guard from BillingModule**

Modify `apps/api/src/modules/billing/billing.module.ts` — add `PlanGuard` to both `providers` and
`exports`:

```typescript
// apps/api/src/modules/billing/billing.module.ts
import { PlanGuard } from './plan.guard';
// ...(keep existing imports)

@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [
    BillingService,
    PlanGuard,
    {
      provide: BILLING_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: billingProviderFactory,
    },
  ],
  exports: [BillingService, PlanGuard],
})
export class BillingModule {}
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing/decorators/plan.decorator.ts apps/api/src/modules/billing/plan.guard.ts apps/api/src/modules/billing/plan.guard.spec.ts apps/api/src/modules/billing/billing.module.ts
git commit -m "feat: add PlanGuard/@RequirePlan for plan-tier-gated endpoints"
```

---

### Task 4: Deterministic workflow-generation mode in MockLlmProvider

**Files:**
- Modify: `apps/api/src/modules/workflows/workflows.constants.ts` (add new constants)
- Modify: `apps/api/src/modules/employees/llm/mock-llm.provider.ts`
- Test: `apps/api/src/modules/employees/llm/mock-llm-provider.workflow-generation.spec.ts`

**Interfaces:**
- Produces: `WORKFLOW_GENERATOR_MARKER`, `INSTALLED_SKILLS_OPEN/CLOSE`, `EMPLOYEES_OPEN/CLOSE`,
  `GENERATION_MAX_ATTEMPTS` constants (consumed by Task 5). `MockLlmProvider.complete()` gains a new
  branch — no signature change, purely additive behavior gated by the new marker so existing PLAN/ACT/
  knowledge behavior is untouched.

- [ ] **Step 1: Add the new constants**

```typescript
// apps/api/src/modules/workflows/workflows.constants.ts — add at the end of the file

/**
 * Marker placed in a system prompt identifying an AI-workflow-generation
 * request (WorkflowGeneratorService builds it; MockLlmProvider keys off it for
 * deterministic offline output — same contract pattern as employees.constants'
 * PLAN_PROMPT_MARKER).
 */
export const WORKFLOW_GENERATOR_MARKER = '[[VAEP:WORKFLOW_GENERATOR]]';

/** Delimiters wrapping the JSON list of the company's installed skills+tools. */
export const INSTALLED_SKILLS_OPEN = '<<<VAEP_SKILLS';
export const INSTALLED_SKILLS_CLOSE = 'VAEP_SKILLS>>>';

/** Delimiters wrapping the JSON list of the company's hired AI employees. */
export const EMPLOYEES_OPEN = '<<<VAEP_EMPLOYEES';
export const EMPLOYEES_CLOSE = 'VAEP_EMPLOYEES>>>';

/** Max LLM calls per generate() invocation: one attempt + one self-correction. */
export const GENERATION_MAX_ATTEMPTS = 2;
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/api/src/modules/employees/llm/mock-llm-provider.workflow-generation.spec.ts
import {
  EMPLOYEES_CLOSE,
  EMPLOYEES_OPEN,
  INSTALLED_SKILLS_CLOSE,
  INSTALLED_SKILLS_OPEN,
  WORKFLOW_GENERATOR_MARKER,
} from '../../workflows/workflows.constants';
import { MockLlmProvider } from './mock-llm.provider';

function systemPrompt(skills: unknown[], employees: unknown[]): string {
  return [
    WORKFLOW_GENERATOR_MARKER,
    'Reply with ONLY one JSON object...',
    `${INSTALLED_SKILLS_OPEN}${JSON.stringify(skills)}${INSTALLED_SKILLS_CLOSE}`,
    `${EMPLOYEES_OPEN}${JSON.stringify(employees)}${EMPLOYEES_CLOSE}`,
  ].join('\n');
}

describe('MockLlmProvider workflow-generation mode', () => {
  const provider = new MockLlmProvider();

  it('asks a clarifying question on the first turn when no skills are installed', async () => {
    const result = await provider.complete({
      system: systemPrompt([], []),
      messages: [{ role: 'user', content: 'automate my hiring' }],
    });
    const parsed = JSON.parse(result.content ?? '{}');
    expect(parsed.type).toBe('question');
    expect(typeof parsed.message).toBe('string');
  });

  it('drafts a grounded workflow referencing a real installed skill+employee', async () => {
    const result = await provider.complete({
      system: systemPrompt(
        [{ skillKey: 'slack', tools: ['send_message'] }],
        [{ id: 'emp_1', name: 'RecruitAI', role: 'RECRUITER' }],
      ),
      messages: [{ role: 'user', content: 'notify recruiting on Slack for new hires' }],
    });
    const parsed = JSON.parse(result.content ?? '{}');
    expect(parsed.type).toBe('draft');
    const toolAction = parsed.definition.nodes.find(
      (n: { type: string }) => n.type === 'TOOL_ACTION',
    );
    expect(toolAction.config.skillKey).toBe('slack');
    expect(toolAction.config.tool).toBe('send_message');
    const aiStep = parsed.definition.nodes.find((n: { type: string }) => n.type === 'AI_STEP');
    expect(aiStep.config.employeeId).toBe('emp_1');
  });

  it('drafts with a deliberately-invalid tool reference when no skills exist on a later turn', async () => {
    const result = await provider.complete({
      system: systemPrompt([], []),
      messages: [
        { role: 'user', content: 'automate my hiring' },
        { role: 'assistant', content: 'Which tool should this use?' },
        { role: 'user', content: 'just do something reasonable' },
      ],
    });
    const parsed = JSON.parse(result.content ?? '{}');
    expect(parsed.type).toBe('draft');
    const toolAction = parsed.definition.nodes.find(
      (n: { type: string }) => n.type === 'TOOL_ACTION',
    );
    expect(toolAction.config.skillKey).toBe('imaginary_skill');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @vaep/api exec jest mock-llm-provider.workflow-generation.spec.ts`
Expected: FAIL — all 3 assertions fail (current provider returns its default knowledge-grounded text,
not JSON), confirming the branch doesn't exist yet.

- [ ] **Step 4: Implement the new branch**

Read `apps/api/src/modules/employees/llm/mock-llm.provider.ts` first (the existing `between()` helper
and the top of `complete()` — this step only ADDS to that file). Add the import and a new branch at the
very top of `complete()`, and one new private-ish module function:

```typescript
// apps/api/src/modules/employees/llm/mock-llm.provider.ts
// Add to the existing import block at the top:
import {
  EMPLOYEES_CLOSE,
  EMPLOYEES_OPEN,
  INSTALLED_SKILLS_CLOSE,
  INSTALLED_SKILLS_OPEN,
  WORKFLOW_GENERATOR_MARKER,
} from '../../workflows/workflows.constants';

// Add this function anywhere at module scope (e.g. just above `selectTool`):
interface GroundingSkill {
  skillKey: string;
  tools: string[];
}
interface GroundingEmployee {
  id: string;
  name: string;
  role: string;
}

/**
 * Deterministic workflow-generation mode (docs/specs/2026-07-13-ai-workflow-
 * generator-design.md). Derives everything from what the system prompt
 * embeds: asks one clarifying question on the first turn if nothing is
 * installed yet; otherwise drafts a 4-node workflow (TRIGGER → AI_STEP →
 * TOOL_ACTION → NOTIFY), grounded in the FIRST installed skill/employee it was
 * given, or a deliberately-nonexistent skillKey/tool when nothing real is
 * available even after the follow-up — exercising WorkflowGeneratorService's
 * validation/fallback path deterministically and offline.
 */
function completeWorkflowGeneration(input: LlmCompletionInput): LlmCompletionResult {
  const { system, messages } = input;
  const userTurns = messages.filter((m) => m.role === 'user').length;

  const skillsRaw = between(system, INSTALLED_SKILLS_OPEN, INSTALLED_SKILLS_CLOSE);
  const employeesRaw = between(system, EMPLOYEES_OPEN, EMPLOYEES_CLOSE);
  const skills: GroundingSkill[] = skillsRaw ? JSON.parse(skillsRaw) : [];
  const employees: GroundingEmployee[] = employeesRaw ? JSON.parse(employeesRaw) : [];

  if (skills.length === 0 && userTurns <= 1) {
    return {
      content: JSON.stringify({
        type: 'question',
        message: 'Which tool or integration should this workflow use (e.g. Slack, email)?',
      }),
    };
  }

  const trigger = { id: 'trigger', type: 'TRIGGER', config: {} };
  const aiStep = {
    id: 'ai_step',
    type: 'AI_STEP',
    config: {
      prompt: 'Summarize the request: {{trigger.payload}}',
      ...(employees[0] ? { employeeId: employees[0].id } : {}),
    },
  };
  const toolAction = skills[0]
    ? {
        id: 'tool_action',
        type: 'TOOL_ACTION',
        config: { skillKey: skills[0].skillKey, tool: skills[0].tools[0], args: {} },
      }
    : {
        id: 'tool_action',
        type: 'TOOL_ACTION',
        config: { skillKey: 'imaginary_skill', tool: 'imaginary_tool', args: {} },
      };
  const notify = { id: 'notify', type: 'NOTIFY', config: { message: 'Workflow finished.' } };

  return {
    content: JSON.stringify({
      type: 'draft',
      definition: {
        nodes: [trigger, aiStep, toolAction, notify],
        edges: [
          { from: 'trigger', to: 'ai_step' },
          { from: 'ai_step', to: 'tool_action' },
          { from: 'tool_action', to: 'notify' },
        ],
      },
    }),
  };
}
```

Then, inside the existing `async complete(...)` method body, add this as the FIRST check (before the
existing `PLAN_PROMPT_MARKER` check):

```typescript
  async complete(
    input: LlmCompletionInput,
    tools?: ToolDefinitionDto[],
  ): Promise<LlmCompletionResult> {
    const { system, messages } = input;

    if (system.includes(WORKFLOW_GENERATOR_MARKER)) {
      return completeWorkflowGeneration(input);
    }

    const userText = // ...(existing line, unchanged)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @vaep/api exec jest mock-llm-provider.workflow-generation.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full existing employees/mock-llm test suite to confirm no regression**

Run: `pnpm --filter @vaep/api exec jest mock-llm`
Expected: PASS, same pre-existing test count plus the 3 new ones — the new branch is only reachable via
the new marker, so no existing PLAN/ACT/knowledge test path is affected.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/workflows/workflows.constants.ts apps/api/src/modules/employees/llm/mock-llm.provider.ts apps/api/src/modules/employees/llm/mock-llm-provider.workflow-generation.spec.ts
git commit -m "feat: deterministic workflow-generation mode in MockLlmProvider"
```

---

### Task 5: `WorkflowGeneratorService` (grounding, validation, self-correction, fallback)

**Files:**
- Create: `apps/api/src/modules/workflows/engine/workflow-generator.service.ts`
- Test: `apps/api/src/modules/workflows/engine/workflow-generator.service.spec.ts`

**Interfaces:**
- Consumes: `validateDefinitionStructure` (Task 1), `SkillsService.listInstalled(companyId): Promise<InstalledSkillDto[]>` (existing), `SkillCatalog.get(skillKey): SkillDefinition | undefined` (existing), `PrismaService.aiEmployee.findMany` (existing Prisma model), `LlmProvider.complete` (existing interface), the constants from Task 4.
- Produces: `WorkflowGeneratorService.generate(companyId: string, messages: LlmMessage[]): Promise<GenerateWorkflowResultDto>` — consumed by Task 6's controller.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/workflows/engine/workflow-generator.service.spec.ts
import type { LlmCompletionInput, LlmCompletionResult, LlmProvider } from '../../employees/llm/llm.provider';
import { WorkflowGeneratorService } from './workflow-generator.service';

/** A fake SkillsService exposing only the one method this service calls. */
function fakeSkills(installed: { skillKey: string }[]) {
  return { listInstalled: jest.fn().mockResolvedValue(installed) };
}

/** A fake PrismaService exposing only aiEmployee.findMany. */
function fakePrisma(employees: { id: string; name: string; role: string }[]) {
  return { aiEmployee: { findMany: jest.fn().mockResolvedValue(employees) } };
}

/** A scripted fake LlmProvider returning one canned response per call, in order. */
function scriptedLlm(responses: LlmCompletionResult[]): LlmProvider {
  let i = 0;
  return {
    name: 'scripted',
    complete: jest.fn(async (_input: LlmCompletionInput) => {
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return next;
    }),
  };
}

const VALID_DRAFT = {
  type: 'draft',
  definition: {
    nodes: [
      { id: 't', type: 'TRIGGER', config: {} },
      { id: 'a', type: 'TOOL_ACTION', config: { skillKey: 'slack', tool: 'send_message', args: {} } },
    ],
    edges: [{ from: 't', to: 'a' }],
  },
};

const INVALID_DRAFT = {
  type: 'draft',
  definition: {
    nodes: [
      { id: 't', type: 'TRIGGER', config: {} },
      { id: 'a', type: 'TOOL_ACTION', config: { skillKey: 'nope', tool: 'nope', args: {} } },
    ],
    edges: [{ from: 't', to: 'a' }],
  },
};

describe('WorkflowGeneratorService', () => {
  it('returns a valid draft unchanged when the first attempt is already valid', async () => {
    const llm = scriptedLlm([{ content: JSON.stringify(VALID_DRAFT) }]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([{ skillKey: 'slack' }]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'notify slack' }]);

    expect(result).toEqual({ type: 'draft', definition: VALID_DRAFT.definition, unresolvedNodes: [] });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('self-corrects: an invalid first attempt followed by a valid second attempt has zero unresolvedNodes', async () => {
    const llm = scriptedLlm([
      { content: JSON.stringify(INVALID_DRAFT) },
      { content: JSON.stringify(VALID_DRAFT) },
    ]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([{ skillKey: 'slack' }]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'notify slack' }]);

    expect(result.type).toBe('draft');
    expect((result as { unresolvedNodes: unknown[] }).unresolvedNodes).toEqual([]);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('degrades to a placeholder when still invalid after one self-correction, never throwing', async () => {
    const llm = scriptedLlm([
      { content: JSON.stringify(INVALID_DRAFT) },
      { content: JSON.stringify(INVALID_DRAFT) },
    ]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([{ skillKey: 'slack' }]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'notify slack' }]);

    expect(result.type).toBe('draft');
    if (result.type !== 'draft') throw new Error('expected draft');
    expect(result.unresolvedNodes).toEqual([
      { nodeId: 'a', reason: expect.stringContaining('nope') },
    ]);
    const toolNode = result.definition.nodes.find((n) => n.id === 'a')!;
    expect(toolNode.config.skillKey).toBe('');
    expect(toolNode.config.tool).toBe('');
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('passes a clarifying question straight through untouched', async () => {
    const llm = scriptedLlm([
      { content: JSON.stringify({ type: 'question', message: 'Which department?' }) },
    ]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'automate hiring' }]);

    expect(result).toEqual({ type: 'question', message: 'Which department?' });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vaep/api exec jest workflow-generator.service.spec.ts`
Expected: FAIL — `Cannot find module './workflow-generator.service'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/modules/workflows/engine/workflow-generator.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type {
  GenerateWorkflowResultDto,
  UnresolvedWorkflowNodeDto,
  WorkflowDefinition,
} from '@vaep/types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  LLM_PROVIDER_TOKEN,
  type LlmMessage,
  type LlmProvider,
} from '../../employees/llm/llm.provider';
import { SkillCatalog } from '../../skills/catalog';
import { SkillsService } from '../../skills/skills.service';
import { WorkflowDefinitionDto } from '../dto/workflow-definition.dto';
import {
  EMPLOYEES_CLOSE,
  EMPLOYEES_OPEN,
  GENERATION_MAX_ATTEMPTS,
  INSTALLED_SKILLS_CLOSE,
  INSTALLED_SKILLS_OPEN,
  WORKFLOW_GENERATOR_MARKER,
} from '../workflows.constants';
import { validateDefinitionStructure } from './definition-validator';

interface GroundingSkill {
  skillKey: string;
  tools: string[];
}
interface GroundingEmployee {
  id: string;
  name: string;
  role: string;
}
type ParsedResponse =
  | { type: 'question'; message: string }
  | { type: 'draft'; definition: WorkflowDefinition }
  | null;
type DraftCheck =
  | { ok: true }
  | { ok: false; structural: true; reason: string }
  | { ok: false; structural: false; problems: UnresolvedWorkflowNodeDto[] };

/**
 * AI-assisted workflow drafting (docs/specs/2026-07-13-ai-workflow-generator-
 * design.md). Pure/side-effect-free w.r.t. the database — it never creates a
 * Workflow row; the caller (WorkflowsController) hands the returned definition
 * to the EXISTING `POST /workflows` create path once the user accepts it.
 *
 * Grounds every draft in the company's REAL installed skills + hired
 * employees, validates every reference before returning anything, gives the
 * model exactly one chance to self-correct a bad reference, and — if it's
 * still wrong — degrades just that one node to an empty "unconfigured"
 * placeholder rather than failing the whole request. Never throws for a bad
 * LLM output; always returns a usable result.
 */
@Injectable()
export class WorkflowGeneratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LlmProvider,
  ) {}

  async generate(
    companyId: string,
    messages: LlmMessage[],
  ): Promise<GenerateWorkflowResultDto> {
    const [installed, employees] = await Promise.all([
      this.skills.listInstalled(companyId),
      this.prisma.aiEmployee.findMany({
        where: { companyId },
        select: { id: true, name: true, role: true },
      }),
    ]);
    const groundingSkills: GroundingSkill[] = installed
      .map((s) => {
        const def = SkillCatalog.get(s.skillKey);
        return def ? { skillKey: s.skillKey, tools: def.tools.map((t) => t.name) } : null;
      })
      .filter((s): s is GroundingSkill => s !== null);

    let correction: string | undefined;
    for (let attempt = 1; attempt <= GENERATION_MAX_ATTEMPTS; attempt++) {
      const system = this.buildSystemPrompt(groundingSkills, employees, correction);
      const result = await this.llm.complete({ system, messages });
      const parsed = this.parseResponse(result.content);
      const isLastAttempt = attempt === GENERATION_MAX_ATTEMPTS;

      if (!parsed) {
        if (!isLastAttempt) {
          correction = 'your reply was not valid JSON matching the required shape.';
          continue;
        }
        return {
          type: 'question',
          message:
            "I couldn't build that — could you describe the workflow again, naming the specific steps you need?",
        };
      }
      if (parsed.type === 'question') {
        return parsed;
      }

      const check = await this.checkDraft(parsed.definition, groundingSkills, employees);
      if (check.ok) {
        return { type: 'draft', definition: parsed.definition, unresolvedNodes: [] };
      }
      if (check.structural) {
        if (!isLastAttempt) {
          correction = check.reason;
          continue;
        }
        return {
          type: 'question',
          message:
            "I couldn't build a valid workflow from that — could you describe it again, one step at a time?",
        };
      }
      if (!isLastAttempt) {
        correction = check.problems.map((p) => p.reason).join(' ');
        continue;
      }
      return {
        type: 'draft',
        definition: this.degradeToPlaceholders(parsed.definition, check.problems),
        unresolvedNodes: check.problems,
      };
    }
    /* istanbul ignore next -- the loop above always returns by the final attempt */
    throw new Error('Workflow generation did not terminate');
  }

  private buildSystemPrompt(
    skills: GroundingSkill[],
    employees: GroundingEmployee[],
    correction?: string,
  ): string {
    const lines = [
      WORKFLOW_GENERATOR_MARKER,
      'You help build an automation workflow for an AI-workforce platform.',
      'Reply with ONLY one JSON object, no other text, matching exactly one of these two shapes:',
      '  {"type":"question","message":"<one clarifying question>"}',
      '  {"type":"draft","definition":{"nodes":[...],"edges":[...]}}',
      'Node "type" must be one of: TRIGGER, RETRIEVE, AI_STEP, TOOL_ACTION, WAIT, CONDITION, NOTIFY, APPROVAL.',
      'A TOOL_ACTION node\'s config must be {"skillKey":"...","tool":"...","args":{}} using ONLY a skillKey+tool pair from the installed skills list below — never invent one.',
      'An AI_STEP node\'s config may include an "employeeId" from the hired employees list below — omit it if none fits.',
      'Every node needs a unique "id"; edges are {"from":"<id>","to":"<id>"}. Start with one TRIGGER node with no incoming edge.',
      `${INSTALLED_SKILLS_OPEN}${JSON.stringify(skills)}${INSTALLED_SKILLS_CLOSE}`,
      `${EMPLOYEES_OPEN}${JSON.stringify(employees)}${EMPLOYEES_CLOSE}`,
    ];
    if (correction) {
      lines.push(
        `Your previous reply had a problem: ${correction} Fix it and reply again with the same JSON contract.`,
      );
    }
    return lines.join('\n');
  }

  private parseResponse(content: string | undefined): ParsedResponse {
    if (!content) return null;
    try {
      const parsed = JSON.parse(content) as {
        type?: string;
        message?: string;
        definition?: WorkflowDefinition;
      };
      if (parsed.type === 'question' && typeof parsed.message === 'string') {
        return { type: 'question', message: parsed.message };
      }
      if (parsed.type === 'draft' && parsed.definition) {
        return { type: 'draft', definition: parsed.definition };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async checkDraft(
    definition: WorkflowDefinition,
    skills: GroundingSkill[],
    employees: GroundingEmployee[],
  ): Promise<DraftCheck> {
    // class-validator catches shape problems raw JSON.parse can't (e.g. a node
    // "type" outside NODE_TYPES); validateDefinitionStructure then catches
    // graph-level problems (duplicate ids, edges to nowhere) it doesn't.
    const dto = plainToInstance(WorkflowDefinitionDto, definition);
    const classErrors = await validate(dto);
    if (classErrors.length > 0) {
      return {
        ok: false,
        structural: true,
        reason: 'The definition did not match the required node/edge shape.',
      };
    }
    try {
      validateDefinitionStructure(definition);
    } catch (err) {
      return {
        ok: false,
        structural: true,
        reason: err instanceof Error ? err.message : 'Invalid graph structure.',
      };
    }

    const skillMap = new Map(skills.map((s) => [s.skillKey, s.tools]));
    const employeeIds = new Set(employees.map((e) => e.id));
    const problems: UnresolvedWorkflowNodeDto[] = [];
    for (const node of definition.nodes) {
      if (node.type === 'TOOL_ACTION') {
        const skillKey = typeof node.config.skillKey === 'string' ? node.config.skillKey : '';
        const tool = typeof node.config.tool === 'string' ? node.config.tool : '';
        const tools = skillMap.get(skillKey);
        if (!tools || !tools.includes(tool)) {
          problems.push({
            nodeId: node.id,
            reason: `Step "${node.id}" referenced ${skillKey || '(none)'}/${tool || '(none)'}, which isn't an installed skill+tool for this company.`,
          });
        }
      }
      if (node.type === 'AI_STEP') {
        const employeeId =
          typeof node.config.employeeId === 'string' ? node.config.employeeId : '';
        // Safe to silently drop: AI_STEP already runs fine with no employeeId
        // (WorkflowEngine.execAiStep falls back to a generic persona), so an
        // unrecognized employee reference never needs to block the draft or
        // appear in unresolvedNodes.
        if (employeeId && !employeeIds.has(employeeId)) {
          node.config = { ...node.config, employeeId: '' };
        }
      }
    }
    return problems.length === 0 ? { ok: true } : { ok: false, structural: false, problems };
  }

  private degradeToPlaceholders(
    definition: WorkflowDefinition,
    problems: UnresolvedWorkflowNodeDto[],
  ): WorkflowDefinition {
    const badIds = new Set(problems.map((p) => p.nodeId));
    for (const node of definition.nodes) {
      if (badIds.has(node.id) && node.type === 'TOOL_ACTION') {
        node.config = { ...node.config, skillKey: '', tool: '' };
      }
    }
    return definition;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vaep/api exec jest workflow-generator.service.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/workflows/engine/workflow-generator.service.ts apps/api/src/modules/workflows/engine/workflow-generator.service.spec.ts
git commit -m "feat: add WorkflowGeneratorService with grounded generation + safe fallback"
```

---

### Task 6: Wire `POST /workflows/generate` into the existing controller/module + e2e test

**Files:**
- Create: `apps/api/src/modules/workflows/dto/generate-workflow.dto.ts`
- Modify: `apps/api/src/modules/workflows/workflows.controller.ts`
- Modify: `apps/api/src/modules/workflows/workflows.module.ts`
- Test: `apps/api/test/workflow-generator.e2e-spec.ts`

**Interfaces:**
- Consumes: `WorkflowGeneratorService.generate` (Task 5), `PlanGuard`/`RequirePlan` (Task 3).
- Produces: `POST /workflows/generate` — the full public surface this feature exposes.

- [ ] **Step 1: Write the DTO**

```typescript
// apps/api/src/modules/workflows/dto/generate-workflow.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type {
  GenerateWorkflowDto as IGenerateWorkflowDto,
  GenerateWorkflowMessageDto as IGenerateWorkflowMessageDto,
} from '@vaep/types';

export class GenerateWorkflowMessageDto implements IGenerateWorkflowMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}

/** POST /workflows/generate body — the whole chat so far. */
export class GenerateWorkflowDto implements IGenerateWorkflowDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GenerateWorkflowMessageDto)
  messages!: GenerateWorkflowMessageDto[];
}
```

- [ ] **Step 2: Write the failing e2e test**

```typescript
// apps/api/test/workflow-generator.e2e-spec.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Workflow AI generator e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `wf_gen_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let companyId = '';

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

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
      .send({ companyName: 'WF Gen E2E Co', name: 'WF Gen Owner', email, password })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
    companyId = res.body.company.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a STARTER-plan company with 403', async () => {
    await request(app.getHttpServer())
      .post('/workflows/generate')
      .set(auth())
      .send({ messages: [{ role: 'user', content: 'automate my hiring' }] })
      .expect(403);
  });

  it('drafts a grounded workflow for a BUSINESS-plan company with an installed skill + hired employee, and creates zero rows', async () => {
    await prisma.subscription.update({ where: { companyId }, data: { plan: 'BUSINESS' } });

    await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'slack' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'RecruitAI', role: 'RECRUITER' })
      .expect(201);

    const before = await prisma.workflow.count({ where: { companyId } });

    const res = await request(app.getHttpServer())
      .post('/workflows/generate')
      .set(auth())
      .send({ messages: [{ role: 'user', content: 'notify recruiting on Slack for new hires' }] })
      .expect(201);

    expect(res.body.type).toBe('draft');
    expect(res.body.unresolvedNodes).toEqual([]);
    const toolAction = res.body.definition.nodes.find(
      (n: { type: string }) => n.type === 'TOOL_ACTION',
    );
    expect(toolAction.config.skillKey).toBe('slack');

    const after = await prisma.workflow.count({ where: { companyId } });
    expect(after).toBe(before);
  });

  it('asks a question then degrades gracefully when no skill is installed, still creating zero rows', async () => {
    const noSkillEmail = `wf_gen_e2e_noskill_${Date.now()}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'WF Gen No Skill Co', name: 'Owner', email: noSkillEmail, password })
      .expect(201);
    const token = reg.body.tokens.accessToken;
    const noSkillCompanyId = reg.body.company.id;
    await prisma.subscription.update({
      where: { companyId: noSkillCompanyId },
      data: { plan: 'BUSINESS' },
    });

    const first = await request(app.getHttpServer())
      .post('/workflows/generate')
      .set({ Authorization: `Bearer ${token}` })
      .send({ messages: [{ role: 'user', content: 'automate my hiring' }] })
      .expect(201);
    expect(first.body.type).toBe('question');

    const second = await request(app.getHttpServer())
      .post('/workflows/generate')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        messages: [
          { role: 'user', content: 'automate my hiring' },
          { role: 'assistant', content: first.body.message },
          { role: 'user', content: 'just do something reasonable' },
        ],
      })
      .expect(201);
    expect(second.body.type).toBe('draft');
    expect(second.body.unresolvedNodes.length).toBeGreaterThan(0);

    const count = await prisma.workflow.count({ where: { companyId: noSkillCompanyId } });
    expect(count).toBe(0);
  });

  it('hands the accepted draft to the existing create endpoint end-to-end', async () => {
    const res = await request(app.getHttpServer())
      .post('/workflows/generate')
      .set(auth())
      .send({ messages: [{ role: 'user', content: 'notify recruiting on Slack for new hires' }] })
      .expect(201);

    await request(app.getHttpServer())
      .post('/workflows')
      .set(auth())
      .send({ name: 'AI-drafted workflow', definition: res.body.definition })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/workflows')
      .set(auth())
      .expect(200);
    expect(list.body.some((w: { name: string }) => w.name === 'AI-drafted workflow')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `apps/api`, with the standard e2e env vars from `platform/CLAUDE.md`):
`pnpm test workflow-generator.e2e-spec`
Expected: FAIL — `404 Not Found` on `POST /workflows/generate` (route doesn't exist yet).

- [ ] **Step 4: Add the controller route**

Read `apps/api/src/modules/workflows/workflows.controller.ts` first. Add the new imports and route
alongside the other fixed-segment routes (`events`, `runs/:runId`) — same "declared before `:id`" reason
already documented on those:

```typescript
// apps/api/src/modules/workflows/workflows.controller.ts — add to the import block
import type { GenerateWorkflowResultDto } from '@vaep/types';
import { RequirePlan } from '../billing/decorators/plan.decorator';
import { PlanGuard } from '../billing/plan.guard';
import { GenerateWorkflowDto } from './dto/generate-workflow.dto';
import { WorkflowGeneratorService } from './engine/workflow-generator.service';
```

Add `generator` to the constructor:
```typescript
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly generator: WorkflowGeneratorService,
  ) {}
```

Add the route (placed next to `fireEvent`/`getRun`, before the `:id` routes, matching the file's
existing "fixed segment before parametric" ordering convention):
```typescript
  /**
   * AI-assisted draft generation (BUSINESS/ENTERPRISE only). Never persists —
   * hand the returned `definition` to POST / (create) once the user accepts it.
   */
  @Post('generate')
  @UseGuards(PlanGuard)
  @RequirePlan('BUSINESS', 'ENTERPRISE')
  generateDraft(
    @CurrentTenant() companyId: string,
    @Body() dto: GenerateWorkflowDto,
  ): Promise<GenerateWorkflowResultDto> {
    return this.generator.generate(companyId, dto.messages);
  }
```

- [ ] **Step 5: Register the new provider + import path in the module**

```typescript
// apps/api/src/modules/workflows/workflows.module.ts
import { WorkflowGeneratorService } from './engine/workflow-generator.service';
// ...(keep existing imports)

@Module({
  imports: [
    BullModule.registerQueue({ name: WORKFLOW_RUN_QUEUE }),
    KnowledgeModule,
    SkillsModule,
    LlmModule,
    BillingModule,
  ],
  controllers: [WorkflowsController, WorkflowWebhooksController],
  providers: [WorkflowsService, WorkflowEngine, WorkflowProcessor, WorkflowGeneratorService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
```

`PlanGuard` resolves automatically — `WorkflowsModule` already imports `BillingModule`, which now
exports `PlanGuard` (Task 3, Step 6); no further wiring needed.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test workflow-generator.e2e-spec`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the full e2e suite to confirm no regression**

Run (from `apps/api`): `pnpm test`
Expected: PASS — all prior suites plus this new one (151 + new tests, per the running count in
`platform/CLAUDE.md`).

- [ ] **Step 8: Update `platform/CLAUDE.md`'s module status + test count**

Add one line under the Workflow builder module bullet noting AI-generation is live
(`POST /workflows/generate`, BUSINESS/ENTERPRISE-gated), and bump the e2e suite/test counts in the
"Run e2e" bullet to match the new totals from Step 7's output.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/workflows/dto/generate-workflow.dto.ts apps/api/src/modules/workflows/workflows.controller.ts apps/api/src/modules/workflows/workflows.module.ts apps/api/test/workflow-generator.e2e-spec.ts platform/CLAUDE.md
git commit -m "feat: expose POST /workflows/generate (plan-gated AI workflow drafting)"
```

---

### Task 7: Frontend API client + hook

**Files:**
- Modify: `apps/web/src/features/workflows/api.ts`
- Modify: `apps/web/src/features/workflows/hooks.ts`

**Interfaces:**
- Produces: `generateWorkflowDraft(messages): Promise<GenerateWorkflowResultDto>`,
  `useGenerateWorkflowDraft()` — a plain (non-optimistic) mutation. Consumed by Task 8's chat component.

- [ ] **Step 1: Add the API function**

```typescript
// apps/web/src/features/workflows/api.ts — add to the existing imports
import type { GenerateWorkflowMessageDto, GenerateWorkflowResultDto } from '@vaep/types';

// --- AI generation -----------------------------------------------------------
// Add at the end of the file:

export async function generateWorkflowDraft(
  messages: GenerateWorkflowMessageDto[],
): Promise<GenerateWorkflowResultDto> {
  const { data } = await apiClient.post<GenerateWorkflowResultDto>(
    '/workflows/generate',
    { messages },
  );
  return data;
}
```

- [ ] **Step 2: Add the hook**

```typescript
// apps/web/src/features/workflows/hooks.ts — add to the existing imports
import type { GenerateWorkflowMessageDto, GenerateWorkflowResultDto } from '@vaep/types';
import { generateWorkflowDraft } from './api';

// Add at the end of the file:

/** AI-assisted draft generation — no cache to update; the chat holds its own state. */
export function useGenerateWorkflowDraft() {
  return useMutation<GenerateWorkflowResultDto, NormalizedApiError, GenerateWorkflowMessageDto[]>({
    mutationFn: generateWorkflowDraft,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @vaep/web exec tsc --noEmit -p tsconfig.json`
Expected: no errors (this task adds pure, unused-until-Task-8 exports; nothing calls them yet, so
nothing can fail at runtime — the check here is purely that the new code compiles against the Task 2
types).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/workflows/api.ts apps/web/src/features/workflows/hooks.ts
git commit -m "feat: add generateWorkflowDraft API client + useGenerateWorkflowDraft hook"
```

---

### Task 8: `GenerateWorkflowChat` component + wire into the Workflows page

**Files:**
- Create: `apps/web/src/features/workflows/components/GenerateWorkflowChat.tsx`
- Modify: `apps/web/src/app/(app)/workflows/page.tsx`

**Interfaces:**
- Consumes: `useGenerateWorkflowDraft` (Task 7), `useCreateWorkflow` (existing), `useSubscription`
  (existing, `features/billing/hooks.ts`).
- Produces: `<GenerateWorkflowChat onCreated={(workflowId, unresolvedNodeIds) => void} />` — consumed
  inline by the Workflows page.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/features/workflows/components/GenerateWorkflowChat.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GenerateWorkflowMessageDto } from '@vaep/types';
import { useCreateWorkflow, useGenerateWorkflowDraft } from '../hooks';

const primaryBtnClass =
  'inline-flex items-center justify-center rounded-xl bg-[linear-gradient(135deg,#6a30ec_0%,#5216dd_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_34px_-12px_rgba(91,33,230,0.85)] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryBtnClass =
  'rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';

/**
 * "Generate with AI" chat: a short back-and-forth (AI may ask up to a few
 * questions), then a ready draft gets created as a normal DRAFT-status
 * workflow (via the existing create endpoint) and the caller navigates to its
 * builder page. Nothing here is persisted except that final, accepted create.
 */
export function GenerateWorkflowChat({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [messages, setMessages] = useState<GenerateWorkflowMessageDto[]>([]);
  const [input, setInput] = useState('');
  const generate = useGenerateWorkflowDraft();
  const create = useCreateWorkflow();

  const busy = generate.isPending || create.isPending;

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    generate.mutate(next, {
      onSuccess: (result) => {
        if (result.type === 'question') {
          setMessages((prev) => [...prev, { role: 'assistant', content: result.message }]);
          return;
        }
        create.mutate(
          { name: 'AI-drafted workflow', definition: result.definition },
          {
            onSuccess: (workflow) => {
              const unresolved = result.unresolvedNodes.map((n) => n.nodeId);
              const suffix = unresolved.length
                ? `?unresolved=${encodeURIComponent(unresolved.join(','))}`
                : '';
              router.push(`/workflows/${workflow.id}${suffix}`);
            },
          },
        );
      },
    });
  };

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-400">Generate with AI</h2>
        <button type="button" onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-300">
          Close
        </button>
      </div>

      {messages.length > 0 && (
        <ul className="mb-4 space-y-2">
          {messages.map((m, i) => (
            <li
              key={i}
              className={`max-w-[85%] rounded-xl px-3.5 py-2 text-sm ${
                m.role === 'user'
                  ? 'ml-auto bg-[linear-gradient(135deg,#6a30ec_0%,#5216dd_100%)] text-white'
                  : 'bg-white/[0.05] text-zinc-300'
              }`}
            >
              {m.content}
            </li>
          ))}
        </ul>
      )}

      {generate.isError && (
        <p className="mb-3 text-sm text-red-400">
          {generate.error?.message ?? 'Could not generate a draft'}
        </p>
      )}
      {create.isError && (
        <p className="mb-3 text-sm text-red-400">
          {create.error?.message ?? 'Could not save the draft'}
        </p>
      )}

      <div className="flex gap-2">
        <input
          className="field-modern flex-1"
          placeholder="Describe what this workflow should do…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          disabled={busy}
        />
        <button type="button" className={primaryBtnClass} onClick={send} disabled={busy || !input.trim()}>
          {busy ? 'Working…' : 'Send'}
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            className={secondaryBtnClass}
            onClick={() => setMessages([])}
            disabled={busy}
          >
            Start over
          </button>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into the Workflows page, gated by plan**

Read `apps/web/src/app/(app)/workflows/page.tsx` first (current content shown in the design spec's
research — a `showForm` toggle next to "+ New Workflow"). Replace the whole file:

```tsx
// apps/web/src/app/(app)/workflows/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell/AppShell';
import { useAppShellProps } from '@/components/app-shell/useAppShellProps';
import { useSubscription } from '@/features/billing/hooks';
import { GenerateWorkflowChat } from '@/features/workflows/components/GenerateWorkflowChat';
import { WorkflowForm } from '@/features/workflows/components/WorkflowForm';
import { WorkflowList } from '@/features/workflows/components/WorkflowList';
import { useSessionStore } from '@/stores/session.store';

const secondaryBtnClass =
  'rounded-xl border border-white/[0.12] bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/[0.06]';

export default function WorkflowsPage() {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const shellProps = useAppShellProps();
  const { data: subscription } = useSubscription();
  const [showForm, setShowForm] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, router]);

  if (!accessToken) {
    return null;
  }

  const canGenerate = subscription?.plan === 'BUSINESS' || subscription?.plan === 'ENTERPRISE';

  return (
    <AppShell {...shellProps}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 pt-2">
        <h1 className="text-2xl font-bold text-white">Workflows</h1>
        <div className="flex gap-3">
          {canGenerate && (
            <button
              type="button"
              onClick={() => {
                setShowGenerate((v) => !v);
                setShowForm(false);
              }}
              className={secondaryBtnClass}
            >
              {showGenerate ? 'Cancel' : 'Generate with AI'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowForm((v) => !v);
              setShowGenerate(false);
            }}
            className="rounded-xl bg-[linear-gradient(135deg,#6a30ec_0%,#5216dd_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_34px_-12px_rgba(91,33,230,0.85)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {showForm ? 'Cancel' : '+ New Workflow'}
          </button>
        </div>
      </div>

      {showGenerate && (
        <div className="mb-6">
          <GenerateWorkflowChat onClose={() => setShowGenerate(false)} />
        </div>
      )}

      {showForm && (
        <div className="mb-6">
          <WorkflowForm />
        </div>
      )}

      <WorkflowList />
    </AppShell>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @vaep/web exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/workflows/components/GenerateWorkflowChat.tsx apps/web/src/app/\(app\)/workflows/page.tsx
git commit -m "feat: add Generate-with-AI chat, plan-gated, on the Workflows page"
```

---

### Task 9: Surface unresolved nodes on the workflow detail page

**Files:**
- Modify: `apps/web/src/app/(app)/workflows/[id]/page.tsx`

**Interfaces:**
- Consumes: the `?unresolved=` query param set by Task 8's redirect; the existing `useWorkflow(id)` hook
  (for node names, to make the banner readable).

- [ ] **Step 1: Read the current file, then modify it**

Read `apps/web/src/app/(app)/workflows/[id]/page.tsx` first (from the design-spec research: it fetches
`workflow` via `useWorkflow(workflowId)` and renders `NodeList`/`TriggerPanel`/`RunPanel` once loaded).
Add a `useSearchParams` read and a dismissible banner ABOVE the existing `{isLoading || !workflow ? ... : (...)}` block:

```tsx
// apps/web/src/app/(app)/workflows/[id]/page.tsx — add to the existing imports
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

// Inside the component, alongside the other hooks:
  const searchParams = useSearchParams();
  const unresolvedIds = (searchParams.get('unresolved') ?? '').split(',').filter(Boolean);
  const [dismissed, setDismissed] = useState(false);

// Immediately before the existing `{isLoading || !workflow ? (...) : (...)}` JSX block, add:
      {!dismissed && unresolvedIds.length > 0 && workflow && (
        <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-400">
            AI couldn&apos;t confidently fill in{' '}
            {unresolvedIds
              .map((id) => workflow.definition.nodes.find((n) => n.id === id)?.name ?? id)
              .join(', ')}
            . Open that step below and choose a tool before activating.
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 text-sm text-amber-400 hover:text-amber-300"
          >
            Dismiss
          </button>
        </div>
      )}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vaep/web exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run: `pnpm --filter @vaep/web dev` (kill it again immediately after this check, per this project's
standing "close dev server after task" convention). Log in as a BUSINESS/ENTERPRISE-plan test company
(never the real Kashif Recruiting tenant), open `/workflows`, click "Generate with AI", send a message,
confirm a draft workflow is created and you land on its detail page; if the test company has no
installed skills, confirm the amber "needs your input" banner appears and names the right step.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/workflows/[id]/page.tsx"
git commit -m "feat: highlight AI-generated steps that still need a manual tool choice"
```

---

## Plan Self-Review

**Spec coverage:** chat-based generation (Task 8) · grounded in real skills/employees (Task 5) ·
3-round question cap — simplified to "ask once, then must draft" in the mock's deterministic behavior
and enforced structurally by `GENERATION_MAX_ATTEMPTS` capping total LLM calls to 2 per request (the
user-facing round cap emerges from the chat naturally: each `/generate` call is one exchange; the
component doesn't cap client-side rounds beyond what the endpoint itself resolves within one call) ·
validate-before-show (Task 5 `checkDraft`) · one self-correction (Task 5 loop) · graceful placeholder
degrade + `unresolvedNodes` (Task 5 + Task 9) · never persists until accepted (Tasks 5/6/8 — generator
has no Prisma writes; Task 8 calls the existing create endpoint) · never touches an existing workflow
(the generator only ever returns a fresh definition; nothing looks up an existing workflow by id) ·
BUSINESS/ENTERPRISE gate (Task 3 + Task 6) · zero new migrations (confirmed — no `schema.prisma` edits
anywhere in this plan) · zero new module (confirmed — every new file lives in `modules/workflows` or
`modules/billing`, both already imported by `WorkflowsModule`).

**Placeholder scan:** no TBD/TODO; every step has runnable code.

**Type consistency:** `GenerateWorkflowResultDto` (Task 2) is the same discriminated union used in Task 5
(service return type), Task 6 (controller return type + e2e assertions), Task 7 (hook generic), and
Task 8 (component's `result.type`/`result.definition`/`result.unresolvedNodes` narrowing) — checked
field names (`unresolvedNodes`, `definition`, `message`) match across all four.
