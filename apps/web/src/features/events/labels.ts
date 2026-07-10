import type { CanonicalEventType } from '@vaep/types';

/** Friendly labels for the canonical event vocabulary (UI display). */
export const CANONICAL_EVENT_LABELS: Record<CanonicalEventType, string> = {
  NEW_EMAIL: 'New email',
  EMAIL_REPLIED: 'Email replied',
  NEW_LEAD: 'New lead',
  LEAD_STAGE_CHANGED: 'Lead stage changed',
  NEW_PAYMENT: 'New payment',
  PAYMENT_FAILED: 'Payment failed',
  NEW_JIRA_ISSUE: 'New Jira issue',
  JIRA_ISSUE_UPDATED: 'Jira issue updated',
  NEW_GITHUB_PR: 'New GitHub PR',
  NEW_GITHUB_ISSUE: 'New GitHub issue',
  NEW_TICKET: 'New ticket',
  NEW_DOCUMENT: 'New document',
  NEW_CANDIDATE: 'New candidate',
  UNKNOWN: 'Unknown event',
};

/** "NEW_GITHUB_PR" → "New GitHub PR" (falls back to the raw value). */
export function formatEventType(type: CanonicalEventType): string {
  return CANONICAL_EVENT_LABELS[type] ?? type;
}
