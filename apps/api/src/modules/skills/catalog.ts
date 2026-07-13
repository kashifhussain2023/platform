import type { SkillDefinitionDto, ToolDefinitionDto } from '@vaep/types';

/**
 * The built-in SKILLS CATALOG — code, not DB. This is the single source of
 * truth for which skills exist, the tools (actions) each exposes, and their
 * parameter contracts. The database only records which skills a company has
 * INSTALLED, which employees they are ASSIGNED to, and an audit log of
 * executions (see prisma models InstalledSkill / EmployeeSkill / SkillExecution).
 *
 * Executors are mock/sandbox by default (see executors/*). Real API executors
 * and a 3rd-party marketplace are later work.
 */

export type ToolDefinition = ToolDefinitionDto;
export type SkillDefinition = SkillDefinitionDto;

const CATALOG: readonly SkillDefinition[] = [
  {
    key: 'slack',
    name: 'Slack',
    description: 'Post messages to Slack channels on behalf of the employee.',
    category: 'communication',
    connection: { type: 'oauth', label: 'Connect Slack' },
    configSchema: [
      {
        key: 'defaultChannel',
        label: 'Default channel',
        type: 'string',
        placeholder: '#general',
        help: 'Channel used when a message does not specify one.',
      },
    ],
    tools: [
      {
        name: 'send_message',
        description: 'Send a message to a Slack channel.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Target channel, e.g. #general.',
            },
            text: { type: 'string', description: 'The message text to post.' },
          },
          required: ['channel', 'text'],
        },
      },
    ],
  },
  {
    key: 'email',
    name: 'Email',
    description: 'Send transactional emails on behalf of the employee.',
    category: 'communication',
    connection: { type: 'api_key', label: 'Connect Email provider' },
    configSchema: [
      {
        key: 'fromAddress',
        label: 'From address',
        type: 'string',
        placeholder: 'no-reply@acme.com',
      },
      {
        key: 'dailyEmailLimit',
        label: 'Daily email limit',
        type: 'number',
        help: 'Soft cap on emails per day (enforcement is a TODO).',
      },
      { key: 'signature', label: 'Signature', type: 'textarea' },
      { key: 'businessHoursStart', label: 'Business hours start', type: 'string', placeholder: '09:00' },
      { key: 'businessHoursEnd', label: 'Business hours end', type: 'string', placeholder: '17:00' },
      { key: 'canRead', label: 'Can read inbox', type: 'boolean' },
      { key: 'canSend', label: 'Can send email', type: 'boolean' },
    ],
    tools: [
      {
        name: 'send_email',
        description: 'Send an email to a recipient.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address.' },
            subject: { type: 'string', description: 'Email subject line.' },
            body: { type: 'string', description: 'Email body (plain text).' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
    ],
  },
  {
    key: 'stripe',
    name: 'Stripe',
    description:
      'Create Stripe payment links, and review recent charges/balance ' +
      '(bookkeeping/expense-check read tools).',
    category: 'payments',
    connection: { type: 'api_key', label: 'Connect Stripe' },
    configSchema: [
      {
        key: 'apiKey',
        label: 'Secret API key',
        type: 'string',
        secret: true,
        placeholder: 'sk_live_...',
        help: 'Stored encrypted-at-rest (TODO); never returned in responses.',
      },
      {
        key: 'currency',
        label: 'Default currency',
        type: 'select',
        options: ['usd', 'eur', 'gbp', 'inr'],
      },
    ],
    tools: [
      {
        name: 'create_payment_link',
        description: 'Create a shareable Stripe payment link.',
        // HIGH-RISK: moving money → always routed to the Approval Center.
        highRisk: true,
        parameters: {
          type: 'object',
          properties: {
            amount: {
              type: 'number',
              description: 'Amount in the smallest currency unit (e.g. cents).',
            },
            currency: {
              type: 'string',
              description: 'ISO currency code, e.g. usd.',
            },
            description: {
              type: 'string',
              description: 'What the payment is for.',
            },
          },
          required: ['amount', 'currency', 'description'],
        },
      },
      {
        // Read-only — no money movement, so NOT highRisk. Backs the
        // "bookkeeping questions / expense checks" FinanceAI is meant to do
        // (previously had zero read tool, only create_payment_link).
        name: 'list_charges',
        description: 'List recent Stripe charges (for expense/bookkeeping review).',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Max charges to return (default 10).',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_balance',
        description: "Get the account's current Stripe balance.",
        parameters: { type: 'object', properties: {}, required: [] },
      },
    ],
  },
  {
    key: 'github',
    name: 'GitHub',
    description: 'Open issues in GitHub repositories.',
    category: 'development',
    connection: { type: 'api_key', label: 'Connect GitHub' },
    configSchema: [
      { key: 'defaultOrg', label: 'Default organisation', type: 'string' },
      { key: 'defaultRepo', label: 'Default repository', type: 'string', placeholder: 'octo/hello' },
    ],
    tools: [
      {
        name: 'create_issue',
        description: 'Create an issue in a GitHub repository.',
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository in owner/name form, e.g. octo/hello.',
            },
            title: { type: 'string', description: 'Issue title.' },
            body: { type: 'string', description: 'Issue body (markdown).' },
          },
          required: ['repo', 'title', 'body'],
        },
      },
      {
        // No real executor case exists for this (intentional — revoking a real
        // person's org access is a destructive, hard-to-reverse action on a
        // live external system). Always falls through to the mock executor.
        name: 'remove_collaborator',
        description: 'Remove a collaborator\'s access to a repository (simulated — no live GitHub call is made).',
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form, e.g. octo/hello.' },
            username: { type: 'string', description: 'GitHub username to remove.' },
          },
          required: ['repo', 'username'],
        },
      },
    ],
  },
  {
    key: 'http',
    name: 'HTTP',
    description:
      'Make outbound HTTP requests (real, SSRF-guarded — blocks private/internal hosts).',
    category: 'utility',
    connection: { type: 'none' },
    configSchema: [
      { key: 'baseUrl', label: 'Base URL', type: 'string', placeholder: 'https://api.acme.com' },
      { key: 'authHeader', label: 'Authorization header', type: 'string', secret: true },
    ],
    tools: [
      {
        name: 'request',
        description: 'Perform an HTTP request (mock/sandbox response).',
        parameters: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              description: 'HTTP method.',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            },
            url: { type: 'string', description: 'Absolute request URL.' },
            body: { type: 'string', description: 'Optional request body.' },
          },
          required: ['method', 'url'],
        },
      },
    ],
  },
  {
    key: 'gmail',
    name: 'Gmail',
    description: 'Send and read Gmail on behalf of the employee (OAuth).',
    category: 'communication',
    connection: { type: 'oauth', label: 'Connect Gmail' },
    configSchema: [
      { key: 'companyEmail', label: 'Company email', type: 'string', placeholder: 'team@acme.com' },
      { key: 'dailyEmailLimit', label: 'Daily email limit', type: 'number' },
      { key: 'signature', label: 'Signature', type: 'textarea' },
      { key: 'businessHoursStart', label: 'Business hours start', type: 'string', placeholder: '09:00' },
      { key: 'businessHoursEnd', label: 'Business hours end', type: 'string', placeholder: '17:00' },
      { key: 'canSend', label: 'Can send email', type: 'boolean' },
      { key: 'canRead', label: 'Can read inbox', type: 'boolean' },
    ],
    tools: [
      {
        name: 'send_email',
        description: 'Send an email via Gmail.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address.' },
            subject: { type: 'string', description: 'Email subject line.' },
            body: { type: 'string', description: 'Email body (plain text).' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      {
        name: 'read_inbox',
        description: 'Read recent messages from the inbox.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional search query.' },
          },
          required: [],
        },
      },
    ],
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    description: 'Manage contacts and deals in HubSpot CRM (OAuth).',
    category: 'crm',
    connection: { type: 'oauth', label: 'Connect HubSpot' },
    configSchema: [
      { key: 'pipeline', label: 'Default pipeline', type: 'string' },
      { key: 'dealStages', label: 'Deal stages', type: 'string', help: 'Comma-separated list of stage names.' },
      { key: 'leadStatus', label: 'Default lead status', type: 'string' },
    ],
    tools: [
      {
        name: 'create_contact',
        description: 'Create a contact in HubSpot.',
        parameters: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Contact email address.' },
            name: { type: 'string', description: 'Contact full name.' },
          },
          required: ['email'],
        },
      },
      {
        name: 'update_deal',
        description: 'Update a deal in HubSpot.',
        parameters: {
          type: 'object',
          properties: {
            dealId: { type: 'string', description: 'The deal id.' },
            stage: { type: 'string', description: 'New deal stage.' },
          },
          required: ['dealId', 'stage'],
        },
      },
    ],
  },
  {
    key: 'jira',
    name: 'Jira',
    description:
      'Create, read, list, and transition issues in Jira projects (OAuth).',
    category: 'development',
    connection: { type: 'oauth', label: 'Connect Jira' },
    configSchema: [
      { key: 'project', label: 'Default project key', type: 'string', placeholder: 'ENG' },
      { key: 'issueTypes', label: 'Issue types', type: 'string', help: 'Comma-separated list, e.g. Bug,Task.' },
      { key: 'defaultAssignee', label: 'Default assignee', type: 'string' },
    ],
    tools: [
      {
        name: 'create_issue',
        description: 'Create an issue in a Jira project.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project key, e.g. ENG.' },
            summary: { type: 'string', description: 'Issue summary.' },
            description: { type: 'string', description: 'Issue description.' },
          },
          required: ['project', 'summary'],
        },
      },
      {
        // Previously missing entirely — PMAI/OperationsAI's stated jobs
        // ("chase status updates", "triage requests", "monitor processes")
        // need to READ issue state, not just create new ones.
        name: 'list_issues',
        description: 'List issues in a Jira project, optionally filtered by status.',
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project key, e.g. ENG.' },
            status: { type: 'string', description: 'Filter by status, e.g. "In Progress".' },
          },
          required: ['project'],
        },
      },
      {
        name: 'get_issue',
        description: 'Get one Jira issue by key (status, assignee, description).',
        parameters: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'Issue key, e.g. ENG-123.' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'transition_issue',
        description: 'Move a Jira issue to a new status (e.g. "In Progress" -> "Done").',
        parameters: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'Issue key, e.g. ENG-123.' },
            status: { type: 'string', description: 'Target status.' },
          },
          required: ['issueKey', 'status'],
        },
      },
    ],
  },
  {
    key: 'calendar',
    name: 'Calendar',
    description: 'Create calendar events on behalf of the employee (OAuth).',
    category: 'productivity',
    connection: { type: 'oauth', label: 'Connect Calendar' },
    configSchema: [
      { key: 'defaultCalendar', label: 'Default calendar', type: 'string' },
      { key: 'timezone', label: 'Timezone', type: 'string', placeholder: 'UTC' },
    ],
    tools: [
      {
        name: 'create_event',
        description: 'Create a calendar event, optionally with a real Google Meet video link.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title.' },
            start: { type: 'string', description: 'ISO start datetime.' },
            end: { type: 'string', description: 'ISO end datetime.' },
            addMeetLink: { type: 'boolean', description: 'Auto-generate a real Google Meet join link for this event.' },
          },
          required: ['title', 'start'],
        },
      },
    ],
  },
  {
    key: 'gdrive',
    name: 'Google Drive',
    description: 'Upload, list, and read files in Google Drive (OAuth).',
    category: 'productivity',
    connection: { type: 'oauth', label: 'Connect Google Drive' },
    configSchema: [
      { key: 'rootFolder', label: 'Root folder', type: 'string' },
    ],
    tools: [
      {
        name: 'upload_file',
        description: 'Upload a file to Google Drive.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name.' },
            content: { type: 'string', description: 'File contents.' },
          },
          required: ['name', 'content'],
        },
      },
      {
        // Previously missing entirely — critical for LegalAI ("extracts
        // clauses" from contracts stored in Drive) and every other role that
        // references docs (HR/Finance/Marketing/Procurement/Operations): with
        // only upload_file, NOTHING could ever read a file's content back.
        name: 'list_files',
        description: 'List files in a Google Drive folder.',
        parameters: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'Folder name (default: root folder).' },
          },
          required: [],
        },
      },
      {
        name: 'read_file',
        description: "Read a file's text content from Google Drive by name.",
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name to read.' },
          },
          required: ['name'],
        },
      },
      {
        name: 'create_folder',
        description: 'Create a folder in Google Drive (nested under an optional parent folder).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Folder name.' },
            parent: { type: 'string', description: 'Parent folder name (created if missing); default: root folder.' },
          },
          required: ['name'],
        },
      },
      {
        name: 'move_file',
        description: 'Move a file (by name) into a destination folder (by name, created if missing).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name to move.' },
            toFolder: { type: 'string', description: 'Destination folder name.' },
          },
          required: ['name', 'toFolder'],
        },
      },
    ],
  },
  {
    // Internal capability, not a third-party integration — no OAuth/API key
    // (connection: 'none', like http). Backs bulk-hiring interview scheduling:
    // atomically claims the next open slot from the company's InterviewSlot
    // pool (see modules/scheduling) so concurrent candidate workflow runs
    // never double-book the same interview time.
    key: 'scheduling',
    name: 'Interview Scheduling',
    description: 'Claim the next available interview slot from the company\'s bookable pool and create the real Calendar event (+ Meet link) for it.',
    category: 'productivity',
    connection: { type: 'none' },
    configSchema: [],
    tools: [
      {
        name: 'claim_slot',
        description: 'Atomically claim the next open interview slot for a candidate; creates the real Calendar event + Meet link and skips any slot that conflicts with the real calendar.',
        parameters: {
          type: 'object',
          properties: {
            candidateEmail: { type: 'string', description: 'Candidate email the slot is booked for.' },
            title: { type: 'string', description: 'Calendar event title (default: "Interview — <email>").' },
          },
          required: ['candidateEmail'],
        },
      },
      {
        name: 'reschedule_slot',
        description: "Reschedule an already-booked interview: deletes the old Calendar event, cancels the old slot, and claims + schedules a new one for the same candidate.",
        parameters: {
          type: 'object',
          properties: {
            slotId: { type: 'string', description: 'The BOOKED InterviewSlot id to reschedule.' },
            title: { type: 'string', description: 'Calendar event title for the new slot.' },
          },
          required: ['slotId'],
        },
      },
    ],
  },
];

/** Static registry over the built-in catalog. */
export const SkillCatalog = {
  /** All built-in skills (with their tools). */
  list(): SkillDefinition[] {
    return CATALOG.map((s) => ({ ...s }));
  },

  /** Look up a skill by its key. */
  get(key: string): SkillDefinition | undefined {
    return CATALOG.find((s) => s.key === key);
  },

  /** True when the key names a built-in skill. */
  has(key: string): boolean {
    return CATALOG.some((s) => s.key === key);
  },

  /** Find the tool definition within a skill. */
  getTool(skillKey: string, tool: string): ToolDefinition | undefined {
    return SkillCatalog.get(skillKey)?.tools.find((t) => t.name === tool);
  },

  /**
   * Resolve which skill owns a tool by name, searching the WHOLE catalog.
   * Tool names are NOT globally unique — e.g. both `email` and `gmail` expose
   * `send_email` — so this returns whichever skill happens to appear first in
   * the catalog, which may not be the one actually installed/intended. Kept
   * only as a last-resort fallback; prefer `resolveSkillKey` below whenever a
   * scoped tool list is available.
   */
  skillKeyForTool(tool: string): string | undefined {
    return CATALOG.find((s) => s.tools.some((t) => t.name === tool))?.key;
  },

  /**
   * Resolve which skill owns a returned tool CALL. Prefers the `skillKey` tag
   * on the matching entry of `tools` — the EXACT, already-scoped list this
   * completion call was given (see `SkillsService.getToolsForEmployee`, which
   * tags every tool with its owning installed skill) — since that's
   * unambiguous even when two assigned skills expose a same-named tool.
   * Falls back to the global (ambiguous) search only if the list wasn't
   * tagged, e.g. a caller that doesn't pass `tools` through.
   */
  resolveSkillKey(toolName: string, tools?: ToolDefinition[]): string | undefined {
    const tagged = tools?.find((t) => t.name === toolName)?.skillKey;
    return tagged ?? SkillCatalog.skillKeyForTool(toolName);
  },
};
