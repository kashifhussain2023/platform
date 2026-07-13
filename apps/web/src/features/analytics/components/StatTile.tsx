/** A clean KPI stat tile: label + big number + optional helper/"est." hint. */
export function StatTile({
  label,
  value,
  helper,
  estimate = false,
}: {
  label: string;
  value: string;
  helper?: string;
  /** Marks the number as an illustrative estimate. */
  estimate?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 transition-colors hover:border-white/[0.14]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-400">{label}</p>
        {estimate && (
          <span
            title="Illustrative estimate"
            className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
          >
            est.
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
      {helper && <p className="mt-1 text-xs text-zinc-500">{helper}</p>}
    </div>
  );
}
