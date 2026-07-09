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
    description: 'Create Stripe payment links for customers.',
    category: 'payments',
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
    ],
  },
  {
    key: 'github',
    name: 'GitHub',
    description: 'Open issues in GitHub repositories.',
    category: 'development',
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
    ],
  },
  {
    key: 'http',
    name: 'HTTP',
    description:
      'Make outbound HTTP requests. MOCK ONLY — never makes a real network call.',
    category: 'utility',
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
   * Resolve which skill owns a tool by its (globally unique) tool name. Used by
   * the LLM providers to map a returned tool call back to its skill.
   */
  skillKeyForTool(tool: string): string | undefined {
    return CATALOG.find((s) => s.tools.some((t) => t.name === tool))?.key;
  },
};
