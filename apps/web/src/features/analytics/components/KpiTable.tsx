'use client';

import type { AnalyticsRange, KpiAttainmentDto } from '@vaep/types';
import { useEmployeeKpis } from '../hooks';
import { formatHours, formatNumber } from '../labels';

/** Attainment badge tone: higher-is-better metrics get a green/amber/red scale. */
function scaleClass(pct: number): string {
  if (pct >= 100) return 'bg-green-100 text-green-700';
  if (pct >= 70) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

/**
 * Actual-vs-target attainment (P1 #6). Tasks + success rate use the higher-is-
 * better scale; approvals is "% of the pending cap used" and stays neutral.
 * Renders "—" when the employee has no KPI targets configured.
 */
function AttainmentCell({ a }: { a: KpiAttainmentDto | null }) {
  const parts = a
    ? ([
        { label: 'Tasks', pct: a.tasksPct, neutral: false },
        { label: 'Rate', pct: a.successRatePct, neutral: false },
        { label: 'Appr', pct: a.approvalsPct, neutral: true },
      ].filter((p) => p.pct !== null) as {
        label: string;
        pct: number;
        neutral: boolean;
      }[])
    : [];
  if (parts.length === 0) {
    return <span className="text-gray-300">—</span>;
  }
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {parts.map((p) => (
        <span
          key={p.label}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            p.neutral ? 'bg-gray-100 text-gray-600' : scaleClass(p.pct)
          }`}
          title={`${p.label}: ${p.pct}% of target`}
        >
          {p.label} {p.pct}%
        </span>
      ))}
    </div>
  );
}

/** Per-employee KPI table: name/role, tasks, tool actions, success, attainment. */
export function KpiTable({ range }: { range: AnalyticsRange }) {
  const { data: rows, isLoading } = useEmployeeKpis(range);

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading employee metrics…</p>;
  }
  if (!rows || rows.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No employees yet. Hire an AI employee to see per-employee metrics.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3 text-right">Tasks</th>
            <th className="px-4 py-3 text-right">Tool actions</th>
            <th className="px-4 py-3 text-right">Success</th>
            <th className="px-4 py-3 text-right">Hours saved</th>
            <th className="px-4 py-3 text-right">Attainment</th>
            <th className="px-4 py-3 text-right">Pending</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.employeeId}>
              <td className="px-4 py-3">
                <div className="font-medium text-gray-900">{r.name}</div>
                <div className="text-xs text-gray-400">
                  {r.role} · {r.status.toLowerCase()}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatNumber(r.tasksCompleted)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatNumber(r.toolActions)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                {formatNumber(r.toolSuccess)}
                {r.toolErrors > 0 && (
                  <span className="text-red-500"> / {formatNumber(r.toolErrors)} err</span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                {formatHours(r.hoursSaved)}
              </td>
              <td className="px-4 py-3 text-right">
                <AttainmentCell a={r.attainment} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.pendingApprovals > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {formatNumber(r.pendingApprovals)}
                  </span>
                ) : (
                  <span className="text-gray-300">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
