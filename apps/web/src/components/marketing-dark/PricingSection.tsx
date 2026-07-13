'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DarkSectionHeading, DarkHl } from './DarkSectionHeading';

interface Plan {
  name: string;
  monthly: number | null; // null = "Custom"
  blurb: string;
  features: string[];
  cta: string;
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'Starter',
    monthly: 29,
    blurb: 'For small teams getting started',
    features: ['2 AI Employees', 'Limited Workflows', 'Core Integrations', 'Community Support'],
    cta: 'Get Started',
  },
  {
    name: 'Pro',
    monthly: 99,
    blurb: 'For growing businesses',
    features: ['10 AI Employees', 'Advanced Workflows', 'All Integrations', 'Priority Support'],
    cta: 'Get Started',
    popular: true,
  },
  {
    name: 'Business',
    monthly: 249,
    blurb: 'For scaling teams',
    features: ['Unlimited AI Employees', 'Advanced Analytics', 'Custom Workflows', 'Priority Support'],
    cta: 'Get Started',
  },
  {
    name: 'Enterprise',
    monthly: null,
    blurb: 'For large organizations',
    features: ['Everything in Business', 'SSO & SAML', 'On-premise option', 'Dedicated Support'],
    cta: 'Contact Sales',
  },
];

/** Pricing — Monthly/Annual toggle + 4 plan cards (Pro highlighted). */
export function PricingSection() {
  const [annual, setAnnual] = useState(true);

  return (
    <section id="pricing" className="border-t border-white/[0.06] py-20 sm:py-28">
      <div className="mx-auto max-w-[1440px] px-8">
        <DarkSectionHeading kicker="Pricing">
          Simple, transparent pricing that <DarkHl>scales with you</DarkHl>
        </DarkSectionHeading>

        {/* billing toggle */}
        <div className="mt-8 flex justify-center">
          <div className="inline-flex items-center rounded-full border border-white/[0.08] bg-void-card p-1">
            <button
              type="button"
              onClick={() => setAnnual(false)}
              className={cn(
                'rounded-full px-5 py-1.5 text-sm font-medium transition-colors',
                !annual ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:text-white',
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setAnnual(true)}
              className={cn(
                'rounded-full px-5 py-1.5 text-sm font-medium transition-colors',
                annual ? 'bg-violet text-white' : 'text-zinc-400 hover:text-white',
              )}
            >
              Annual (Save 20%)
            </button>
          </div>
        </div>

        {/* plan cards */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => {
            // Listed price is the annual-billing /mo rate; monthly billing costs ~20% more.
            const price =
              plan.monthly == null
                ? 'Custom'
                : annual
                  ? `$${plan.monthly}`
                  : `$${Math.round(plan.monthly / 0.8)}`;
            return (
              <div
                key={plan.name}
                className={cn(
                  'relative flex flex-col rounded-2xl border p-6',
                  plan.popular
                    ? 'border-violet/60 bg-violet/[0.06] shadow-[0_0_40px_-12px_rgba(94,60,232,0.6)]'
                    : 'border-white/[0.08] bg-void-card',
                )}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet px-3 py-1 text-xs font-semibold text-white">
                    Popular
                  </span>
                )}
                <p className="text-[15px] font-semibold text-white">{plan.name}</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-white">{price}</span>
                  {plan.monthly != null && <span className="text-sm text-zinc-500">/mo</span>}
                </p>
                <p className="mt-2 text-sm text-zinc-500">{plan.blurb}</p>

                <ul className="mt-6 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-300">
                      <Check className="h-4 w-4 shrink-0 text-violet-secondary" strokeWidth={2.5} />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.cta === 'Contact Sales' ? '#' : '/register'}
                  className={cn(
                    'mt-8 inline-flex items-center justify-center rounded-full py-2.5 text-sm font-semibold transition-all',
                    plan.popular
                      ? 'bg-violet text-white hover:bg-violet-hover'
                      : 'border border-white/[0.12] text-white hover:bg-white/[0.06]',
                  )}
                >
                  {plan.cta}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-sm text-zinc-500">
          All plans include usage-based billing for tokens, voice &amp; automation runs.
        </p>
      </div>
    </section>
  );
}
