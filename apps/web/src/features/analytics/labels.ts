import type { AnalyticsRange } from '@vaep/types';

/** Human labels for the range selector, in display order. */
export const RANGE_OPTIONS: ReadonlyArray<{
  value: AnalyticsRange;
  label: string;
}> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

/** Compact number formatter (e.g. 1234 → "1,234"). */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

/** One-decimal formatter for hours (e.g. 12.5). */
export function formatHours(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
  }).format(value);
}

/** USD currency, no cents (e.g. "$1,250"). */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Ratio (0..1) → percent string, or "—" when there's no data. */
export function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}
