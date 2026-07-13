import type { ReactNode } from 'react';
import Link from 'next/link';
import { OrlixaMark } from '@/components/marketing-dark/OrlixaMark';

const STEP_LABELS = [1, 2, 3] as const;

function StepDots({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex shrink-0 items-center gap-2 pt-1">
      {STEP_LABELS.map((n, i) => (
        <div key={n} className="flex items-center gap-2">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
              n === current
                ? 'bg-[linear-gradient(135deg,#6a30ec_0%,#5216dd_100%)] text-white shadow-[0_0_18px_-4px_rgba(91,33,230,0.85)]'
                : n < current
                  ? 'bg-violet/25 text-violet-secondary'
                  : 'bg-white/[0.06] text-zinc-500'
            }`}
          >
            {n}
          </span>
          {i < STEP_LABELS.length - 1 && <span className="h-px w-8 bg-white/[0.12]" />}
        </div>
      ))}
    </div>
  );
}

/**
 * Shared shell for the 3-step onboarding wizard: a full-height split screen —
 * a unique illustration panel on the left, the step content on the right with
 * a heading + step-dot progress. Mirrors `components/auth/AuthShell`'s dark
 * violet theme so onboarding reads as the same product as sign-in/sign-up.
 */
export function OnboardingShell({
  step,
  heading,
  subtitle,
  illustration,
  children,
}: {
  step: 1 | 2 | 3;
  heading: ReactNode;
  subtitle?: ReactNode;
  illustration: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="font-marketing flex min-h-screen bg-[#02030a]">
      <section className="relative hidden w-[34%] shrink-0 overflow-hidden border-r border-white/[0.06] lg:block">
        <Link href="/" className="absolute left-8 top-8 z-10 flex items-center gap-2">
          <OrlixaMark size={26} />
          <span className="text-lg font-bold text-white">Orlixa</span>
        </Link>
        {illustration}
      </section>

      <section className="flex flex-1 items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-xl">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">{heading}</h1>
              {subtitle && <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400">{subtitle}</p>}
            </div>
            <StepDots current={step} />
          </div>

          {children}
        </div>
      </section>
    </main>
  );
}
