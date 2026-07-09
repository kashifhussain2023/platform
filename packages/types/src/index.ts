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

// ---------------------------------------------------------------------------
// Zod schemas (shared validation contract) — web uses these directly.
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  companyName: z.string().min(2, 'Company name is too short').max(120),
  name: z.string().min(1, 'Your name is required').max(120),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
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
  role: Role;
  createdAt: string;
}

/** Public shape of a company/tenant. */
export interface CompanyDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

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

/** PATCH /employees/:id body (status pause/disable, persona, model, name). */
export const updateEmployeeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'DISABLED']).optional(),
  persona: z.string().max(2000).optional(),
  model: z.string().max(120).optional(),
});

/** POST /conversations/:id/messages body. */
export const sendMessageSchema = z.object({
  content: z.string().min(1, 'Enter a message').max(4000),
});

export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;
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
  | 'utility';

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
}

/** A built-in skill in the (code-defined) catalog. */
export interface SkillDefinitionDto {
  key: string;
  name: string;
  description: string;
  category: SkillCategory;
  tools: ToolDefinitionDto[];
}

/** A skill a company has installed (turns a catalog entry on for the tenant). */
export interface InstalledSkillDto {
  id: string;
  companyId: string;
  skillKey: string;
  displayName: string;
  config: Record<string, unknown> | null;
  enabled: boolean;
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

export type InstallSkillDto = z.infer<typeof installSkillSchema>;
export type UpdateInstalledSkillDto = z.infer<typeof updateInstalledSkillSchema>;
export type AssignSkillDto = z.infer<typeof assignSkillSchema>;
export type ExecuteToolDto = z.infer<typeof executeToolSchema>;

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

/** PATCH /workflows/:id body (name/description/definition/status). */
export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  definition: workflowDefinitionSchema.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional(),
});

/** POST /workflows/:id/run body (optional trigger payload). */
export const runWorkflowSchema = z.object({
  trigger: z.record(z.unknown()).optional(),
});

export type CreateWorkflowDto = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowDto = z.infer<typeof updateWorkflowSchema>;
export type RunWorkflowDto = z.infer<typeof runWorkflowSchema>;

// --- DTOs / API contract types ---------------------------------------------

/** Public shape of a workflow. */
export interface WorkflowDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  definition: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
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
  trigger: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  steps?: WorkflowStepRunDto[];
}
