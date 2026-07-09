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
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {estimate && (
          <span
            title="Illustrative estimate"
            className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400"
          >
            est.
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
      {helper && <p className="mt-1 text-xs text-gray-400">{helper}</p>}
    </div>
  );
}
