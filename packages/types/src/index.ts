/**
 * @vaep/types — shared DTO/type definitions.
 *
 * Single source of truth consumed by BOTH the web app and the API.
 * The API imports these as `import type { ... }` (erased at build time, so it
 * never pulls zod into the Nest runtime — it validates with class-validator).
 * The web app uses the zod schemas for react-hook-form validation.
 */
import { z } from 'zod';

/** Tenant membership role. */
export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

export const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MEMBER'] as const;

/** Whether a user account may authenticate. DISABLED users are rejected at login. */
export type UserStatus = 'ACTIVE' | 'DISABLED';

export const USER_STATUSES: readonly UserStatus[] = ['ACTIVE', 'DISABLED'] as const;

// ---------------------------------------------------------------------------
// Zod schemas (shared validation contract) — web uses these directly.
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  companyName: z.string().min(2, 'Company name is too short').max(120),
  name: z.string().min(1, 'Your name is required').max(120),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  // Optional company profile (Step 2 richer registration) + admin phone.
  industry: z.string().max(120).optional(),
  size: z.string().max(40).optional(),
  country: z.string().max(120).optional(),
  timezone: z.string().max(80).optional(),
  website: z.string().max(200).optional(),
  logoUrl: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  phone: z.string().max(40).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

/** Knowledge search form/body contract — web uses this directly (rhf + zod). */
export const searchSchema = z.object({
  query: z.string().min(1, 'Enter a search query').max(1000),
  k: z.number().int().min(1).max(50).optional(),
});

// ---------------------------------------------------------------------------
// DTOs / API contract types.
// ---------------------------------------------------------------------------

/** POST /auth/register body. */
export type RegisterDto = z.infer<typeof registerSchema>;

/** POST /auth/login body. */
export type LoginDto = z.infer<typeof loginSchema>;

/** Tokens returned by register/login. Refresh travels as an httpOnly cookie. */
export interface AuthTokens {
  accessToken: string;
  /** Present only when cookies are unavailable (e.g. non-browser clients). */
  refreshToken?: string;
}

/** Public shape of a user (never includes passwordHash). */
export interface UserDto {
  id: string;
  companyId: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

/** Public shape of a company/tenant. */
export interface CompanyDto {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  size: string | null;
  country: string | null;
  timezone: string | null;
  website: string | null;
  logoUrl: string | null;
  description: string | null;
  /** Set when the AI Onboarding Wizard is completed; null = not yet onboarded. */
  onboardedAt: string | null;
  createdAt: string;
}

/** PATCH /companies/current body — update the company profile. */
export const updateCompanySchema = z.object({
  name: z.string().min(2).max(120).optional(),
  industry: z.string().max(120).optional(),
  size: z.string().max(40).optional(),
  country: z.string().max(120).optional(),
  timezone: z.string().max(80).optional(),
  website: z.string().max(200).optional(),
  logoUrl: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
});

export type UpdateCompanyDto = z.infer<typeof updateCompanySchema>;

/** GET /auth/me response. */
export interface MeDto {
  user: UserDto;
  company: CompanyDto;
}

/** Response envelope for register/login. */
export interface AuthResponse {
  user: UserDto;
  company: CompanyDto;
  tokens: AuthTokens;
}

// ---------------------------------------------------------------------------
// User Management module contracts (RBAC, P0 governance).
// ---------------------------------------------------------------------------
// Company-scoped team management: an OWNER/ADMIN invites (adds) users, edits
// their role, enables/disables (blocks login), and deletes them. Guardrails:
// only an OWNER may create/grant OWNER; you cannot change your own role; the
// last OWNER cannot be demoted, disabled or deleted. Never exposes passwordHash.

/** POST /users body — add a user to the caller's company. */
export const createUserSchema = z.object({
  email: z.string().email('Enter a valid email'),
  name: z.string().min(1, 'Name is required').max(120),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200),
});

/** PATCH /users/:id body — update name/role/status (all optional). */
export const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

// ---------------------------------------------------------------------------
// Knowledge / RAG module contracts.
// ---------------------------------------------------------------------------

/** Ingestion lifecycle of an uploaded knowledge document. */
export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export const DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED',
] as const;

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

/** POST /knowledge/search body. */
export type SearchQueryDto = z.infer<typeof searchSchema>;

/** A single vector-search hit returned by POST /knowledge/search. */
export interface SearchResultDto {
  chunkId: string;
  documentId: string;
  content: string;
  /** Cosine similarity in [0,1]; higher is closer. */
  score: number;
}

// ---------------------------------------------------------------------------
// AI Employee runtime module contracts.
// ---------------------------------------------------------------------------

/** The vertical an AI employee is specialised for. */
export type EmployeeRole =
  | 'SUPPORT'
  | 'SALES'
  | 'RECRUITER'
  | 'HR'
  | 'ACCOUNTANT'
  | 'PROJECT_MANAGER'
  | 'CUSTOM';

export const EMPLOYEE_ROLES: readonly EmployeeRole[] = [
  'SUPPORT',
  'SALES',
  'RECRUITER',
  'HR',
  'ACCOUNTANT',
  'PROJECT_MANAGER',
  'CUSTOM',
] as const;

/** Lifecycle status. Only ACTIVE employees accept new messages. */
export type EmployeeStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

export const EMPLOYEE_STATUSES: readonly EmployeeStatus[] = [
  'ACTIVE',
  'PAUSED',
  'DISABLED',
] as const;

/** Whether an employee may retrieve from the company knowledge base. */
export type KnowledgeAccess = 'ALL' | 'NONE';

export const KNOWLEDGE_ACCESSES: readonly KnowledgeAccess[] = [
  'ALL',
  'NONE',
] as const;

/** Business departments (used by the onboarding wizard + employee catalog). */
export type Department =
  | 'SALES'
  | 'HR'
  | 'CUSTOMER_SUPPORT'
  | 'RECRUITMENT'
  | 'FINANCE';

export const DEPARTMENTS: readonly Department[] = [
  'SALES',
  'HR',
  'CUSTOMER_SUPPORT',
  'RECRUITMENT',
  'FINANCE',
] as const;

/** Author of a conversation message. */
export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

// --- Zod schemas (shared with the web forms) -------------------------------

/** POST /employees body. */
export const createEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  role: z.enum([
    'SUPPORT',
    'SALES',
    'RECRUITER',
    'HR',
    'ACCOUNTANT',
    'PROJECT_MANAGER',
    'CUSTOM',
  ]),
  persona: z.string().max(2000).optional(),
  model: z.string().max(120).optional(),
});

/**
 * Rich AI-employee configuration (Step 5). Shared by the employee settings
 * panel. All fields optional; folded into the PATCH /employees/:id body.
 */
export const employeeConfigSchema = z.object({
  department: z.string().max(120).optional(),
  managerName: z.string().max(120).optional(),
  workingHoursStart: z.string().max(10).optional(),
  workingHoursEnd: z.string().max(10).optional(),
  timezone: z.string().max(80).optional(),
  language: z.string().max(80).optional(),
  knowledgeAccess: z.enum(['ALL', 'NONE']).optional(),
  budgetLimit: z.number().int().min(0).max(100000000).nullable().optional(),
  permissions: z.record(z.boolean()).optional(),
  approvalRules: z.record(z.unknown()).optional(),
});

/** PATCH /employees/:id body (status pause/disable, persona, model, name, rich config). */
export const updateEmployeeSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'DISABLED']).optional(),
    persona: z.string().max(2000).optional(),
    model: z.string().max(120).optional(),
  })
  .merge(employeeConfigSchema);

/** POST /conversations/:id/messages body. */
export const sendMessageSchema = z.object({
  content: z.string().min(1, 'Enter a message').max(4000),
});

export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;
export type EmployeeConfigDto = z.infer<typeof employeeConfigSchema>;
export type SendMessageDto = z.infer<typeof sendMessageSchema>;

// --- DTOs / API contract types ---------------------------------------------

/** Public shape of an AI employee. */
export interface AiEmployeeDto {
  id: string;
  companyId: string;
  name: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  persona: string | null;
  model: string | null;
  department: string | null;
  managerName: string | null;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  timezone: string | null;
  language: string | null;
  knowledgeAccess: KnowledgeAccess;
  budgetLimit: number | null;
  permissions: Record<string, boolean> | null;
  approvalRules: Record<string, unknown> | null;
  createdAt: string;
}

/** A conversation thread with one AI employee. */
export interface ConversationDto {
  id: string;
  companyId: string;
  employeeId: string;
  title: string | null;
  createdAt: string;
}

/** Verdict produced by the runtime ValidationService for an answer. */
export interface MessageValidationDto {
  /** True when the answer is backed by retrieved company knowledge. */
  grounded: boolean;
  /** Confidence in the answer, in [0,1]. */
  confidence: number;
  /** True when a human should approve before acting (low confidence / high-stakes role). */
  needsApproval: boolean;
  /** Human-readable rationale for the verdict. */
  notes?: string;
}

/** Structured runtime metadata persisted alongside an assistant message. */
export interface MessageMetadataDto {
  /** The step plan the runtime followed. */
  plan?: string[];
  /** Knowledge chunks cited while drafting the answer. */
  sources?: SearchResultDto[];
  /** Grounding / confidence verdict. */
  validation?: MessageValidationDto;
  /** Skill/tool actions the employee took during the run (empty when none). */
  toolCalls?: ToolCallDto[];
}

/** A single conversation message. */
export interface MessageDto {
  id: string;
  companyId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: MessageMetadataDto | null;
  createdAt: string;
}

/** Response of POST /conversations/:id/messages — the full agent run outcome. */
export interface RunResultDto {
  /** The persisted assistant message. */
  message: MessageDto;
  /** Step plan the agent followed. */
  plan: string[];
  /** Knowledge chunks retrieved and cited. */
  sources: SearchResultDto[];
  /** Grounding / confidence verdict. */
  validation: MessageValidationDto;
  /** Skill/tool actions taken during the run (empty when the employee used none). */
  toolCalls: ToolCallDto[];
}

// ---------------------------------------------------------------------------
// Continuous Learning module contracts (Step 15).
// ---------------------------------------------------------------------------
// Managers give 👍/👎 feedback on AI outputs (optionally teaching a correction).
// A 👎 with a correction — or an explicit teach — is promoted to a durable FACT
// EmployeeMemory (source 'FEEDBACK') that the runtime recalls on future runs. The
// same durable memories are curated (list / manually teach / forget) here.

/** A manager's rating of an AI output. */
export type FeedbackRating = 'UP' | 'DOWN';

export const FEEDBACK_RATINGS: readonly FeedbackRating[] = ['UP', 'DOWN'] as const;

/** How a memory came to exist: from feedback, taught manually, or a run summary. */
export type MemorySource = 'FEEDBACK' | 'MANUAL' | 'RUN';

/** A durable long-term employee memory (recalled by the runtime by recency). */
export type MemoryKind = 'FACT' | 'SUMMARY';

export const MEMORY_KINDS: readonly MemoryKind[] = ['FACT', 'SUMMARY'] as const;

// --- Zod schemas (shared with the web forms) -------------------------------

/** POST /employees/:id/feedback body. */
export const createFeedbackSchema = z.object({
  conversationId: z.string().min(1).max(60).optional(),
  messageId: z.string().min(1).max(60).optional(),
  rating: z.enum(['UP', 'DOWN']),
  note: z.string().max(2000).optional(),
  /** A corrected/preferred answer — promoted to a durable FACT memory. */
  correction: z.string().max(2000).optional(),
  /** Force promoting `correction` (or `note`) to a durable memory even for 👍. */
  teach: z.boolean().optional(),
});

/** POST /employees/:id/memories body (manually teach a durable memory). */
export const createMemorySchema = z.object({
  kind: z.enum(['FACT', 'SUMMARY']),
  content: z.string().min(1, 'Enter something to teach').max(2000),
});

export type CreateFeedbackDto = z.infer<typeof createFeedbackSchema>;
export type CreateMemoryDto = z.infer<typeof createMemorySchema>;

// --- DTOs / API contract types ---------------------------------------------

/** A single piece of manager feedback on an AI output. */
export interface EmployeeFeedbackDto {
  id: string;
  companyId: string;
  employeeId: string;
  conversationId: string | null;
  messageId: string | null;
  rating: FeedbackRating;
  note: string | null;
  correction: string | null;
  createdAt: string;
}

/** A durable long-term employee memory row. */
export interface EmployeeMemoryDto {
  id: string;
  companyId: string;
  employeeId: string;
  kind: MemoryKind;
  content: string;
  /** Provenance: 'FEEDBACK' | 'MANUAL' | 'RUN'; null for legacy/summary writes. */
  source: MemorySource | null;
  createdAt: string;
}

/** GET /employees/:id/learning response — a compact learning summary. */
export interface LearningSummaryDto {
  feedback: { up: number; down: number; total: number };
  memories: { total: number; byKind: Record<MemoryKind, number> };
  /** Most recent feedback, newest first. */
  recentFeedback: EmployeeFeedbackDto[];
}

// ---------------------------------------------------------------------------
// Onboarding module contracts (Steps 2–5).
// ---------------------------------------------------------------------------
// The AI Onboarding Wizard: capture the company business profile, pick
// departments, then hire AI employees from a code-defined role catalog. The
// company itself remains the tenant; completing the wizard stamps
// company.onboardedAt.

/** A hireable AI-employee role template surfaced in the onboarding catalog. */
export interface EmployeeRoleTemplate {
  role: EmployeeRole;
  suggestedName: string;
  title: string;
  description: string;
  /** Departments this template belongs to (filtered by wizard selection). */
  departments: Department[];
}

/** GET /onboarding/status response. */
export interface OnboardingStatusDto {
  completed: boolean;
}

/** POST /onboarding/complete body. */
export const completeOnboardingSchema = z.object({
  business: z
    .object({
      industry: z.string().max(120).optional(),
      size: z.string().max(40).optional(),
      description: z.string().max(2000).optional(),
    })
    .optional(),
  departments: z.array(z.string().max(40)),
  employees: z.array(
    z.object({
      role: z.enum([
        'SUPPORT',
        'SALES',
        'RECRUITER',
        'HR',
        'ACCOUNTANT',
        'PROJECT_MANAGER',
        'CUSTOM',
      ]),
      name: z.string().max(120).optional(),
    }),
  ),
});

export type CompleteOnboardingDto = z.infer<typeof completeOnboardingSchema>;

/** POST /onboarding/complete response. */
export interface CompleteOnboardingResultDto {
  company: CompanyDto;
  employees: AiEmployeeDto[];
}

// ---------------------------------------------------------------------------
// Skills module contracts.
// ---------------------------------------------------------------------------
// A code-defined catalog of built-in skills, each exposing tools (actions). A
// company INSTALLS a skill; installed skills are ASSIGNED to employees; the
// runtime lets an employee CALL an assigned tool during its "act" step. Every
// execution is logged (audit). Executors are mock/sandbox by default.

/** Grouping used to organise the built-in catalog in the UI. */
export type SkillCategory =
  | 'communication'
  | 'payments'
  | 'development'
  | 'utility'
  | 'crm'
  | 'productivity';

/**
 * How a skill authenticates against its (real) backend. `api_key` prompts for a
 * secret key; `oauth` is a stubbed connect flow (real OAuth = TODO); `none` needs
 * no connection (mock/sandbox executors run without one either way).
 */
export type SkillConnectionType = 'oauth' | 'api_key' | 'none';

/** Connection descriptor for a catalog skill. */
export interface SkillConnectionDto {
  type: SkillConnectionType;
  /** Human label for the connect action, e.g. "Connect Slack". */
  label?: string;
}

/** Whether an installed skill has been connected (credentials present). */
export type SkillConnectionStatus = 'NOT_CONNECTED' | 'CONNECTED';

export const SKILL_CONNECTION_STATUSES: readonly SkillConnectionStatus[] = [
  'NOT_CONNECTED',
  'CONNECTED',
] as const;

/** A field in a skill's company-specific configuration form. */
export type ConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'textarea';

/**
 * One data-driven configuration field. The frontend renders an input from its
 * `type`; the backend validates a submitted value against it. `secret:true`
 * fields are stored in `credentials` (masked in responses), never in `config`.
 */
export interface ConfigFieldDto {
  key: string;
  label: string;
  type: ConfigFieldType;
  /** Allowed values for `select` fields. */
  options?: string[];
  /** When true the value is a secret (password input; stored masked). */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
}

/** JSON-schema-ish parameter contract for a single tool. */
export interface ToolParametersDto {
  type: 'object';
  properties: Record<
    string,
    { type: string; description?: string; enum?: string[] }
  >;
  required: string[];
}

/** A single action a skill exposes (maps to LLM tool/function calling). */
export interface ToolDefinitionDto {
  name: string;
  description: string;
  parameters: ToolParametersDto;
  /**
   * When true the tool is inherently HIGH-RISK: the runtime pauses it for human
   * approval (via the Approval Center) instead of executing it directly. Absent/
   * false tools execute as normal (unless an employee's approvalRules require it).
   */
  highRisk?: boolean;
}

/** A built-in skill in the (code-defined) catalog. */
export interface SkillDefinitionDto {
  key: string;
  name: string;
  description: string;
  category: SkillCategory;
  tools: ToolDefinitionDto[];
  /** How the skill connects to its (real) backend. */
  connection: SkillConnectionDto;
  /** Company-specific configuration fields (data-driven form). */
  configSchema: ConfigFieldDto[];
}

/** A skill a company has installed (turns a catalog entry on for the tenant). */
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

/** An assignment of an installed skill to a specific AI employee. */
export interface EmployeeSkillDto {
  id: string;
  companyId: string;
  employeeId: string;
  installedSkillId: string;
  createdAt: string;
}

/** Outcome of a single tool call, surfaced in a run + message metadata. */
export interface ToolCallDto {
  skillKey: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
  /**
   * True when the call was NOT executed because it is high-risk and was routed to
   * the Approval Center; `approvalId` is the created PENDING ApprovalRequest.
   */
  pendingApproval?: boolean;
  approvalId?: string;
}

/** Terminal status of a logged skill execution. */
export type SkillExecutionStatus = 'SUCCESS' | 'ERROR';

/** An audited tool execution row. */
export interface SkillExecutionDto {
  id: string;
  companyId: string;
  employeeId: string | null;
  conversationId: string | null;
  skillKey: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  status: SkillExecutionStatus;
  error: string | null;
  createdAt: string;
}

// --- Zod schemas (shared with the web forms) -------------------------------

/** POST /skills/install body. */
export const installSkillSchema = z.object({
  skillKey: z.string().min(1, 'Skill key is required').max(80),
  displayName: z.string().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
});

/** PATCH /skills/installed/:id body (enable/disable/config/displayName). */
export const updateInstalledSkillSchema = z.object({
  enabled: z.boolean().optional(),
  displayName: z.string().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
});

/** POST /employees/:id/skills body (assign an installed skill). */
export const assignSkillSchema = z.object({
  installedSkillId: z.string().min(1, 'Installed skill id is required'),
});

/** POST /skills/installed/:id/tools/:tool/execute body (manual execution). */
export const executeToolSchema = z.object({
  args: z.record(z.unknown()),
});

/** PATCH /skills/installed/:id/config body (company-specific settings). */
export const configureSkillSchema = z.object({
  config: z.record(z.unknown()),
});

/** POST /skills/installed/:id/connect body (secret credentials / OAuth token). */
export const connectSkillSchema = z.object({
  credentials: z.record(z.unknown()),
});

export type InstallSkillDto = z.infer<typeof installSkillSchema>;
export type UpdateInstalledSkillDto = z.infer<typeof updateInstalledSkillSchema>;
export type AssignSkillDto = z.infer<typeof assignSkillSchema>;
export type ExecuteToolDto = z.infer<typeof executeToolSchema>;
export type ConfigureSkillDto = z.infer<typeof configureSkillSchema>;
export type ConnectSkillDto = z.infer<typeof connectSkillSchema>;

/**
 * GET /skills/installed/:id/oauth/authorize response. `url` is the provider
 * authorization-code URL (with a signed, stateless `state`) that the browser is
 * redirected to; the provider then calls back to the public /skills/oauth/callback.
 */
export interface OAuthAuthorizeDto {
  url: string;
}

// ---------------------------------------------------------------------------
// Workflow builder module contracts.
// ---------------------------------------------------------------------------
// A no-code engine that chains a TRIGGER through AI/retrieve/tool/wait/branch/
// notify nodes. A Workflow holds a graph `definition` ({nodes, edges}); running
// it spawns a WorkflowRun (async, BullMQ) whose engine walks the graph writing a
// WorkflowStepRun per visited node. Nodes reuse the Knowledge (RETRIEVE), LLM
// (AI_STEP) and Skills (TOOL_ACTION) modules. No vector columns here.

/** Lifecycle of a workflow definition. Only ACTIVE workflows are "live". */
export type WorkflowStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';

export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
] as const;

/**
 * How an ACTIVE workflow is invoked (Steps 8/9/11). MANUAL is the default and
 * preserves the existing POST /workflows/:id/run path; the others are
 * event-driven (a repeatable BullMQ job, a public webhook, or an internal event).
 */
export type TriggerType = 'MANUAL' | 'SCHEDULE' | 'WEBHOOK' | 'EVENT';

export const TRIGGER_TYPES: readonly TriggerType[] = [
  'MANUAL',
  'SCHEDULE',
  'WEBHOOK',
  'EVENT',
] as const;

/**
 * Trigger configuration persisted on a workflow. Shape depends on triggerType:
 * SCHEDULE needs `everyMs` (≥15000) OR `cron`; EVENT needs `eventType`;
 * WEBHOOK/MANUAL carry no config.
 */
export interface TriggerConfig {
  /** SCHEDULE: repeat interval in ms (min 15000). */
  everyMs?: number;
  /** SCHEDULE: cron expression (alternative to everyMs). */
  cron?: string;
  /** EVENT: the internal event name this workflow listens for. */
  eventType?: string;
}

/** Terminal/interim status of a single workflow run. */
export type WorkflowRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export const WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
] as const;

/** Status of a single step (one visited node) within a run. */
export type StepRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

/** The kind of a workflow node. `config` shape depends on this. */
export type NodeType =
  | 'TRIGGER'
  | 'RETRIEVE'
  | 'AI_STEP'
  | 'TOOL_ACTION'
  | 'WAIT'
  | 'CONDITION'
  | 'NOTIFY';

export const NODE_TYPES: readonly NodeType[] = [
  'TRIGGER',
  'RETRIEVE',
  'AI_STEP',
  'TOOL_ACTION',
  'WAIT',
  'CONDITION',
  'NOTIFY',
] as const;

/** Comparison operators available to a CONDITION node. */
export type ConditionOp = 'eq' | 'neq' | 'contains' | 'gt' | 'lt';

export const CONDITION_OPS: readonly ConditionOp[] = [
  'eq',
  'neq',
  'contains',
  'gt',
  'lt',
] as const;

/** One node in a workflow graph. Templates use `{{a.b.c}}` context lookups. */
export interface WorkflowNode {
  id: string;
  type: NodeType;
  name?: string;
  config: Record<string, unknown>;
}

/** A directed edge. `branch` selects a CONDITION outcome ('true'/'false'). */
export interface WorkflowEdge {
  from: string;
  to: string;
  branch?: 'true' | 'false';
}

/** The full graph persisted on a workflow. */
export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// --- Per-node config shapes (documentation + FE editor convenience) --------

/** TRIGGER: no configuration (seeds context.trigger with the run payload). */
export type TriggerNodeConfig = Record<string, never>;

/** RETRIEVE: knowledge search. `query` is a template; results → context[outputKey]. */
export interface RetrieveNodeConfig {
  query: string;
  k?: number;
  outputKey: string;
}

/** AI_STEP: LLM completion of a templated prompt; text → context[outputKey]. */
export interface AiStepNodeConfig {
  prompt: string;
  employeeId?: string;
  outputKey: string;
}

/** TOOL_ACTION: run a skill tool; each arg value is a template. Result → context[outputKey]. */
export interface ToolActionNodeConfig {
  skillKey: string;
  tool: string;
  args: Record<string, string>;
  outputKey: string;
}

/** WAIT: bounded delay (capped by the engine). */
export interface WaitNodeConfig {
  durationMs: number;
}

/** CONDITION: compare a templated `left` against a literal `right`. */
export interface ConditionNodeConfig {
  left: string;
  op: ConditionOp;
  right: string;
}

/** NOTIFY: record a templated message in the step output (log-style). */
export interface NotifyNodeConfig {
  message: string;
}

// --- Zod schemas (shared with the web forms) -------------------------------

const workflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'TRIGGER',
    'RETRIEVE',
    'AI_STEP',
    'TOOL_ACTION',
    'WAIT',
    'CONDITION',
    'NOTIFY',
  ]),
  name: z.string().max(200).optional(),
  config: z.record(z.unknown()),
});

const workflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  branch: z.enum(['true', 'false']).optional(),
});

/** Shared graph contract for a workflow definition. */
export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

/** POST /workflows body. */
export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(160),
  description: z.string().max(2000).optional(),
  definition: workflowDefinitionSchema.optional(),
});

/** Shared trigger-config contract (SCHEDULE everyMs/cron · EVENT eventType). */
export const triggerConfigSchema = z.object({
  everyMs: z.number().int().min(15000).optional(),
  cron: z.string().min(1).max(120).optional(),
  eventType: z.string().min(1).max(120).optional(),
});

/** PATCH /workflows/:id body (name/description/definition/status/trigger). */
export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  definition: workflowDefinitionSchema.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional(),
  triggerType: z.enum(['MANUAL', 'SCHEDULE', 'WEBHOOK', 'EVENT']).optional(),
  triggerConfig: triggerConfigSchema.optional(),
});

/** POST /workflows/:id/run body (optional trigger payload). */
export const runWorkflowSchema = z.object({
  trigger: z.record(z.unknown()).optional(),
});

/** POST /workflows/events body — fire an internal event to EVENT-triggered flows. */
export const fireEventSchema = z.object({
  eventType: z.string().min(1).max(120),
  payload: z.record(z.unknown()).optional(),
});

export type CreateWorkflowDto = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowDto = z.infer<typeof updateWorkflowSchema>;
export type RunWorkflowDto = z.infer<typeof runWorkflowSchema>;
export type FireEventDto = z.infer<typeof fireEventSchema>;

// --- DTOs / API contract types ---------------------------------------------

/** Public shape of a workflow. */
export interface WorkflowDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  definition: WorkflowDefinition;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig | null;
  /** Present (for WEBHOOK triggers) once the workflow has been activated. */
  webhookToken: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Result of firing an internal event (POST /workflows/events). */
export interface FireEventResultDto {
  eventType: string;
  /** How many ACTIVE EVENT workflows matched and were enqueued. */
  count: number;
  runIds: string[];
}

/** One visited node's execution record within a run. */
export interface WorkflowStepRunDto {
  id: string;
  companyId: string;
  runId: string;
  nodeId: string;
  type: string;
  status: StepRunStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** A single execution of a workflow. `steps` is included when polling one run. */
export interface WorkflowRunDto {
  id: string;
  companyId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  /** How the run was triggered: MANUAL | SCHEDULE | WEBHOOK | EVENT. */
  source: string;
  trigger: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  steps?: WorkflowStepRunDto[];
}

// ---------------------------------------------------------------------------
// Approval Center module contracts (Step 11).
// ---------------------------------------------------------------------------
// When an AI employee's runtime wants to run a HIGH-RISK tool (per the catalog
// tool's `highRisk` flag OR the employee's `approvalRules`), the action is NOT
// executed. Instead an ApprovalRequest (PENDING) captures the proposed tool call
// and a manager reviews it in the Approval Center: Approve (→ execute now),
// Reject (→ skip), or Modify (→ edit args then execute). Every executed approval
// still logs a SkillExecution (via the Skills module's runTool).

/** Lifecycle of an approval request. Only PENDING requests can be decided. */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;

/**
 * Per-employee approval policy (persisted on `AiEmployee.approvalRules`). A tool
 * needs approval when `requireApprovalForAllTools` is set, OR when
 * `requireApprovalForTools` includes its skill key (`"slack"`) or a fully
 * qualified `"skillKey:tool"` (`"slack:send_message"`).
 */
export interface ApprovalRules {
  requireApprovalForAllTools?: boolean;
  requireApprovalForTools?: string[];
}

/** Public shape of an approval request. */
export interface ApprovalRequestDto {
  id: string;
  companyId: string;
  employeeId: string | null;
  conversationId: string | null;
  skillKey: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  description: string | null;
  status: ApprovalStatus;
  decidedById: string | null;
  decidedAt: string | null;
  note: string | null;
  createdAt: string;
}

// --- Zod schemas (shared with the web forms) -------------------------------

/** POST /approvals/:id/approve|reject body (optional reviewer note). */
export const decideApprovalSchema = z.object({
  note: z.string().max(2000).optional(),
});

/** POST /approvals/:id/modify body (edited args + optional note). */
export const modifyApprovalSchema = z.object({
  args: z.record(z.unknown()),
  note: z.string().max(2000).optional(),
});

export type DecideApprovalDto = z.infer<typeof decideApprovalSchema>;
export type ModifyApprovalDto = z.infer<typeof modifyApprovalSchema>;

// --- Analytics / KPI dashboard ---------------------------------------------
// Read-only aggregation over EXISTING data (SkillExecution, Message/Conversation,
// WorkflowRun, ApprovalRequest, AiEmployee). No new persisted models. `range`
// bounds the activity-style metrics by their relevant `createdAt`; current-state
// counts (employees / pending approvals) are point-in-time. Derived money/time
// figures are ILLUSTRATIVE estimates (see analytics.constants.ts).

/** Time window for a KPI query. `all` = no lower bound. */
export type AnalyticsRange = 'today' | '7d' | '30d' | 'all';

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = [
  'today',
  '7d',
  '30d',
  'all',
] as const;

/** Company-wide KPIs for the selected range. */
export interface OverviewDto {
  range: AnalyticsRange;
  // Raw counts (range-bounded by createdAt).
  toolActions: number;
  toolSuccess: number;
  toolErrors: number;
  conversations: number;
  assistantMessages: number;
  workflowRuns: number;
  workflowCompleted: number;
  workflowFailed: number;
  // Current-state counts (point-in-time, not range-bounded).
  pendingApprovals: number;
  employees: number;
  activeEmployees: number;
  // Derived ILLUSTRATIVE estimates.
  tasksCompleted: number;
  hoursSaved: number;
  costSavings: number;
  successRate: number | null;
  utilization: number;
}

/** Per-employee KPI row. */
export interface EmployeeKpiDto {
  employeeId: string;
  name: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  toolActions: number;
  toolSuccess: number;
  toolErrors: number;
  conversations: number;
  assistantMessages: number;
  pendingApprovals: number;
  // Derived ILLUSTRATIVE estimates (this employee only).
  tasksCompleted: number;
  hoursSaved: number;
}

/** One grouped activity count in the "Today's AI Activity" feed. */
export interface ActivityItemDto {
  label: string;
  count: number;
}

/** Activity feed entry for a single employee (grouped skill/tool + message counts). */
export interface ActivityFeedDto {
  employeeId: string;
  employee: string;
  role: EmployeeRole;
  items: ActivityItemDto[];
}

// ---------------------------------------------------------------------------
// Billing & Subscription module contracts (Steps 1 + 13).
// ---------------------------------------------------------------------------
// One subscription per company (default STARTER/ACTIVE, created at
// registration). A code-defined PLAN_CATALOG (see api billing.plans.ts) is the
// source of truth for prices/limits/features. The active BillingProvider is
// swappable (mock by default, Stripe opt-in). Plan limits are SOFT: usage is
// surfaced with an "over limit" hint but nothing is blocked. Prices are
// ILLUSTRATIVE (from the proposal); ENTERPRISE is custom (null price).

/** Subscription plan tiers. */
export type Plan = 'STARTER' | 'PRO' | 'BUSINESS' | 'ENTERPRISE';

export const PLANS: readonly Plan[] = [
  'STARTER',
  'PRO',
  'BUSINESS',
  'ENTERPRISE',
] as const;

/** Lifecycle of a subscription. */
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
] as const;

/** One entry in the (code-defined) plan catalog. */
export interface PlanDto {
  plan: Plan;
  name: string;
  /** Illustrative monthly price in USD; null = custom (ENTERPRISE). */
  priceMonthlyUsd: number | null;
  /** Soft cap on AI employees; null = unlimited. */
  maxEmployees: number | null;
  features: string[];
}

/** Public shape of a company's subscription. */
export interface SubscriptionDto {
  id: string;
  companyId: string;
  plan: Plan;
  status: SubscriptionStatus;
  /** Which BillingProvider owns it ("mock" | "stripe"). */
  provider: string;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Present only when a (Stripe) provider returns a hosted checkout URL for a
   * plan change; the mock provider switches immediately and omits this. TODO.
   */
  checkoutUrl?: string | null;
}

/**
 * On-the-fly usage snapshot (no usage table). Counts are computed from existing
 * data; `tokens`/`voiceMinutes` are placeholders (0) until real metering (TODO).
 * `overEmployeeLimit` is a SOFT, informational flag — nothing is blocked.
 */
export interface UsageDto {
  plan: Plan;
  /** Soft cap for the current plan; null = unlimited. */
  maxEmployees: number | null;
  employees: number;
  installedSkills: number;
  /** SkillExecution SUCCESS + assistant Messages + WorkflowRun COMPLETED. */
  tasks: number;
  tokens: number;
  voiceMinutes: number;
  overEmployeeLimit: boolean;
}

// --- Zod schemas (shared with the web forms) -------------------------------

/** POST /billing/subscription body (change plan). */
export const changePlanSchema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE']),
});

export type ChangePlanDto = z.infer<typeof changePlanSchema>;

// ---------------------------------------------------------------------------
// Marketplace expansion module contracts (Step 14).
// ---------------------------------------------------------------------------
// A UNIFIED, code-defined catalog to install more AI Employees, Workflow
// Templates, and Skills into a tenant. There are NO new persistence models:
// installs DELEGATE to the existing Employees / Workflows / Skills services.
// Skills reuse the existing SkillDefinitionDto catalog (not duplicated here).

/** A hireable AI-employee template surfaced in the marketplace. */
export interface EmployeeTemplateDto {
  /** Stable install key (unique across the marketplace). */
  key: string;
  /** Suggested display name for the hired employee (e.g. "SalesAI"). */
  name: string;
  /** The employee vertical the template maps to. */
  role: EmployeeRole;
  /** Concise role instruction seeded onto the created employee's persona. */
  persona: string;
  /** UI grouping label (e.g. "Sales", "Legal"). */
  category: string;
  /** Catalog skill keys this template pairs well with (advisory only). */
  suggestedSkills: string[];
  /** Marketing blurb shown on the template card. */
  description: string;
}

/** A ready-to-install workflow template surfaced in the marketplace. */
export interface WorkflowTemplateDto {
  /** Stable install key (unique across the marketplace). */
  key: string;
  name: string;
  description: string;
  /** UI grouping label (e.g. "Recruiting"). */
  category: string;
  /** The full graph installed verbatim (valid: starts with a TRIGGER). */
  definition: WorkflowDefinition;
}

/** GET /marketplace response — the unified, code-defined catalog. */
export interface MarketplaceCatalogDto {
  employees: EmployeeTemplateDto[];
  workflows: WorkflowTemplateDto[];
  /** Reuses the existing Skills catalog verbatim. */
  skills: SkillDefinitionDto[];
}

// --- Zod schemas (shared with the web forms) -------------------------------

/** POST /marketplace/employees/:key/install body (optional name override). */
export const installEmployeeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

export type InstallEmployeeDto = z.infer<typeof installEmployeeSchema>;
