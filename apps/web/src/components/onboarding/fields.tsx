import type { ReactNode } from 'react';

/** A checkbox-driven selectable card — department picker, role picker. */
export function ToggleCard({
  checked,
  onChange,
  children,
  className = '',
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors ${
        checked
          ? 'border-violet-secondary/60 bg-violet/[0.08]'
          : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]'
      } ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-5 w-5 shrink-0 rounded-md border-white/20 bg-white/5 accent-[#6a30ec]"
      />
      {children}
    </label>
  );
}
