import type {
  NodeType,
  StepRunStatus,
  WorkflowRunStatus,
  WorkflowStatus,
} from '@vaep/types';

/** Human labels for each node type. */
export const NODE_LABELS: Record<NodeType, string> = {
  TRIGGER: 'Trigger',
  RETRIEVE: 'Retrieve knowledge',
  AI_STEP: 'AI step',
  TOOL_ACTION: 'Tool action',
  WAIT: 'Wait',
  CONDITION: 'Condition',
  NOTIFY: 'Notify',
  APPROVAL: 'Approval',
};

/** One-line description of what each node type does. */
export const NODE_HINTS: Record<NodeType, string> = {
  TRIGGER: 'Entry point. The run trigger payload is available as {{trigger.*}}.',
  RETRIEVE: 'Search company knowledge for a query and store the results.',
  AI_STEP: 'Ask the LLM to produce text from a templated prompt.',
  TOOL_ACTION: 'Run a skill tool (e.g. Slack) with templated arguments.',
  WAIT: 'Pause for a bounded number of milliseconds.',
  CONDITION: 'Compare two values to branch the flow (types/engine support branches).',
  NOTIFY: 'Record a message in the run log.',
  APPROVAL:
    'Pause the run for a manager decision (Approval Center). Approve resumes; reject fails.',
};

/** Tailwind badge classes for a workflow status. */
export const WORKFLOW_STATUS_STYLES: Record<WorkflowStatus, string> = {
  DRAFT: 'bg-gray-200 text-gray-600',
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-amber-100 text-amber-700',
};

/** Tailwind badge classes for a run status. */
export const RUN_STATUS_STYLES: Record<WorkflowRunStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  RUNNING: 'bg-blue-100 text-blue-700',
  WAITING: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

/** Tailwind badge classes for a step-run status. */
export const STEP_STATUS_STYLES: Record<StepRunStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  RUNNING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-gray-100 text-gray-500',
};

/** Sensible default `config` for a freshly added node of each type. */
export function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case 'RETRIEVE':
      return { query: '{{trigger.query}}', k: 5, outputKey: 'retrieved' };
    case 'AI_STEP':
      return {
        prompt: 'Summarise: {{retrieved}}',
        employeeId: '',
        outputKey: 'aiText',
      };
    case 'TOOL_ACTION':
      return {
        skillKey: 'slack',
        tool: 'send_message',
        args: { channel: '#general', text: '{{aiText}}' },
        outputKey: 'toolResult',
      };
    case 'WAIT':
      return { durationMs: 1000 };
    case 'CONDITION':
      return { left: '{{trigger.value}}', op: 'eq', right: '' };
    case 'NOTIFY':
      return { message: 'Workflow completed: {{aiText}}' };
    case 'APPROVAL':
      return { message: 'Please review and approve this workflow step.' };
    case 'TRIGGER':
    default:
      return {};
  }
}
