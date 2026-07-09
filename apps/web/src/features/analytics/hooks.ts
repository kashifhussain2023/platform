'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  ActivityFeedDto,
  AnalyticsRange,
  EmployeeKpiDto,
  OverviewDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import { getActivityFeed, getEmployeeKpis, getOverview } from './api';

/** Query keys carry the range so switching ranges refetches (or hits its cache). */
export const analyticsKeys = {
  all: ['analytics'] as const,
  overview: (range: AnalyticsRange) => ['analytics', 'overview', range] as const,
  employees: (range: AnalyticsRange) =>
    ['analytics', 'employees', range] as const,
  activity: (range: AnalyticsRange) => ['analytics', 'activity', range] as const,
};

/** Company overview KPIs (read-only). */
export function useOverview(range: AnalyticsRange) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<OverviewDto, NormalizedApiError>({
    queryKey: analyticsKeys.overview(range),
    queryFn: () => getOverview(range),
    enabled: Boolean(accessToken),
  });
}

/** Per-employee KPI rows (read-only). */
export function useEmployeeKpis(range: AnalyticsRange) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<EmployeeKpiDto[], NormalizedApiError>({
    queryKey: analyticsKeys.employees(range),
    queryFn: () => getEmployeeKpis(range),
    enabled: Boolean(accessToken),
  });
}

/** "Today's AI Activity" feed (read-only). */
export function useActivityFeed(range: AnalyticsRange) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<ActivityFeedDto[], NormalizedApiError>({
    queryKey: analyticsKeys.activity(range),
    queryFn: () => getActivityFeed(range),
    enabled: Boolean(accessToken),
  });
}
