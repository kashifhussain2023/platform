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
