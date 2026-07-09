import { apiClient } from '@/lib/apiClient';
import type {
  ActivityFeedDto,
  AnalyticsRange,
  EmployeeKpiDto,
  OverviewDto,
} from '@vaep/types';

/** Company-wide KPIs for the selected range. */
export async function getOverview(range: AnalyticsRange): Promise<OverviewDto> {
  const { data } = await apiClient.get<OverviewDto>('/analytics/overview', {
    params: { range },
  });
  return data;
}

/** Per-employee KPI rows for the selected range. */
export async function getEmployeeKpis(
  range: AnalyticsRange,
): Promise<EmployeeKpiDto[]> {
  const { data } = await apiClient.get<EmployeeKpiDto[]>('/analytics/employees', {
    params: { range },
  });
  return data;
}

/** "Today's AI Activity" feed for the selected range. */
export async function getActivityFeed(
  range: AnalyticsRange,
): Promise<ActivityFeedDto[]> {
  const { data } = await apiClient.get<ActivityFeedDto[]>('/analytics/activity', {
    params: { range },
  });
  return data;
}
