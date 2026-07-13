import type { ElementType } from 'react';
import {
  Bot,
  CheckCircle2,
  Clock,
  GitBranch,
  MessageSquare,
  Search,
  Wrench,
  Zap,
} from 'lucide-react';
import type {
  NodeType,
  StepRunStatus,
  TriggerType,
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

/** Icon per node type — used by the node cards (builder list + run log). */
export const NODE_ICONS: Record<NodeType, ElementType<{ className?: string }>> = {
  TRIGGER: Zap,
  RETRIEVE: Search,
  AI_STEP: Bot,
  TOOL_ACTION: Wrench,
  WAIT: Clock,
  CONDITION: GitBranch,
  NOTIFY: MessageSquare,
  APPROVAL: CheckCircle2,
};

/** Icon badge tone (bg + text) per node type. */
export const NODE_TONES: Record<NodeType, string> = {
  TRIGGER: 'bg-violet/20 text-violet-secondary',
  RETRIEVE: 'bg-sky-500/15 text-sky-400',
  AI_STEP: 'bg-violet/20 text-violet-secondary',
  TOOL_ACTION: 'bg-violet/20 text-violet-secondary',
  WAIT: 'bg-white/[0.06] text-zinc-400',
  CONDITION: 'bg-amber-500/15 text-amber-400',
  NOTIFY: 'bg-emerald-500/15 text-emerald-400',
  APPROVAL: 'bg-violet/20 text-violet-secondary',
};

/** Human label per trigger type (workflow list meta line). */
export const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  MANUAL: 'Manual',
  SCHEDULE: 'Schedule',
  WEBHOOK: 'Webhook',
  EVENT: 'Event',
};

/** Tailwind badge classes for a workflow status. */
export const WORKFLOW_STATUS_STYLES: Record<WorkflowStatus, string> = {
  DRAFT: 'bg-white/[0.06] text-zinc-400',
  ACTIVE: 'bg-green-500/15 text-green-400',
  PAUSED: 'bg-amber-500/15 text-amber-400',
};

/** Tailwind badge classes for a run status. */
export const RUN_STATUS_STYLES: Record<WorkflowRunStatus, string> = {
  PENDING: 'bg-white/[0.06] text-zinc-400',
  RUNNING: 'bg-blue-500/15 text-blue-400',
  WAITING: 'bg-amber-500/15 text-amber-400',
  COMPLETED: 'bg-green-500/15 text-green-400',
  FAILED: 'bg-red-500/15 text-red-400',
};

/** Tailwind badge classes for a step-run status. */
export const STEP_STATUS_STYLES: Record<StepRunStatus, string> = {
  PENDING: 'bg-white/[0.06] text-zinc-400',
  RUNNING: 'bg-blue-500/15 text-blue-400',
  COMPLETED: 'bg-green-500/15 text-green-400',
  FAILED: 'bg-red-500/15 text-red-400',
  SKIPPED: 'bg-white/[0.05] text-zinc-500',
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
