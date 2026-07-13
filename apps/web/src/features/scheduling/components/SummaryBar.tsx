'use client';

import { useSlotSummary } from '../hooks';

/** Open/booked/cancelled slot counts. */
export function SummaryBar() {
  const { data: summary, isLoading } = useSlotSummary();

  if (isLoading || !summary) {
    return <p className="text-sm text-zinc-500">Loading summary…</p>;
  }

  const items: Array<{ label: string; value: number }> = [
    { label: 'Open', value: summary.open },
    { label: 'Booked', value: summary.booked },
    { label: 'Cancelled', value: summary.cancelled },
  ];

  return (
    <div className="flex gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex-1 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 text-center"
        >
          <p className="text-2xl font-bold text-white">{item.value}</p>
          <p className="text-xs text-zinc-500">{item.label}</p>
        </div>
      ))}
    </div>
  );
}
