'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import type { Department, EmployeeRoleTemplate } from '@vaep/types';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { ToggleCard } from '@/components/onboarding/fields';
import {
  AstronautIllustration,
  LaunchIllustration,
  SkylineIllustration,
} from '@/components/onboarding/illustrations';
import { useUpdateCompany } from '@/features/tenant/hooks';
import { useCompleteOnboarding, useOnboardingCatalog } from '../hooks';
import { COMPANY_SIZES, formatDepartment } from '../labels';
import { DEPARTMENTS } from '../schemas';

interface HireState {
  selected: boolean;
  name: string;
}

const labelClass = 'mb-1.5 block text-sm font-medium text-zinc-300';
const fieldClass = 'field-modern';
const backBtnClass =
  'rounded-xl border border-white/[0.12] bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtnClass =
  'inline-flex items-center justify-center rounded-xl bg-[linear-gradient(135deg,#6a30ec_0%,#5216dd_100%)] px-8 py-3 text-sm font-semibold text-white shadow-[0_14px_34px_-12px_rgba(91,33,230,0.85)] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The 3-step AI Onboarding Wizard (local state only):
 *   1. Business profile (industry/size/description) → PATCH company.
 *   2. Choose departments.
 *   3. Hire AI employees from the catalog (filtered by chosen departments).
 * Finishing POSTs /onboarding/complete then routes to /dashboard.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const updateCompany = useUpdateCompany();
  const completeOnboarding = useCompleteOnboarding();
  const { data: catalog } = useOnboardingCatalog();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [industry, setIndustry] = useState('');
  const [size, setSize] = useState('');
  const [description, setDescription] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  // role -> hire choice (selected + editable name).
  const [hires, setHires] = useState<Record<string, HireState>>({});

  const availableTemplates = useMemo<EmployeeRoleTemplate[]>(() => {
    if (!catalog) return [];
    if (departments.length === 0) return catalog;
    return catalog.filter((t) => t.departments.some((d) => departments.includes(d)));
  }, [catalog, departments]);

  const toggleDepartment = (dept: Department) => {
    setDepartments((prev) => (prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept]));
  };

  const hireFor = (t: EmployeeRoleTemplate): HireState =>
    hires[t.role] ?? { selected: false, name: t.suggestedName };

  const toggleHire = (t: EmployeeRoleTemplate) => {
    setHires((prev) => {
      const current = prev[t.role] ?? { selected: false, name: t.suggestedName };
      return { ...prev, [t.role]: { ...current, selected: !current.selected } };
    });
  };

  const setHireName = (t: EmployeeRoleTemplate, name: string) => {
    setHires((prev) => {
      const current = prev[t.role] ?? { selected: true, name: t.suggestedName };
      return { ...prev, [t.role]: { ...current, name } };
    });
  };

  const onSaveBusiness = () => {
    updateCompany.mutate(
      {
        industry: industry.trim() || undefined,
        size: size || undefined,
        description: description.trim() || undefined,
      },
      { onSuccess: () => setStep(2) },
    );
  };

  const onFinish = () => {
    const employees = availableTemplates
      .filter((t) => hireFor(t).selected)
      .map((t) => ({ role: t.role, name: hireFor(t).name.trim() || t.suggestedName }));

    completeOnboarding.mutate(
      {
        business: {
          industry: industry.trim() || undefined,
          size: size || undefined,
          description: description.trim() || undefined,
        },
        departments,
        employees,
      },
      { onSuccess: () => router.replace('/dashboard') },
    );
  };

  const illustration =
    step === 1 ? <LaunchIllustration /> : step === 2 ? <SkylineIllustration /> : <AstronautIllustration />;

  return (
    <OnboardingShell
      step={step}
      illustration={illustration}
      heading={
        <>
          Let&apos;s set up your
          <br />
          AI workforce
        </>
      }
      subtitle="A few quick steps and your first AI employees will be ready to work."
    >
      {step === 1 && (
        <section className="space-y-5">
          <h2 className="text-lg font-semibold text-white">Tell us about your business</h2>

          <div>
            <label htmlFor="industry" className={labelClass}>
              Industry
            </label>
            <input
              id="industry"
              className={fieldClass}
              placeholder="e.g. SaaS, Retail, Healthcare"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="size" className={labelClass}>
              Company size
            </label>
            <div className="relative">
              <select
                id="size"
                className={`${fieldClass} appearance-none pr-9`}
                value={size}
                onChange={(e) => setSize(e.target.value)}
              >
                <option value="">Select…</option>
                {COMPANY_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} employees
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            </div>
          </div>

          <div>
            <label htmlFor="description" className={labelClass}>
              What does your company do? <span className="text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="description"
              rows={3}
              className={fieldClass}
              placeholder="A short description helps your AI employees understand your business."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {updateCompany.isError && (
            <p className="text-sm text-red-400">
              {updateCompany.error?.message ?? 'Could not save your business'}
            </p>
          )}

          <div className="flex justify-end pt-1">
            <button type="button" className={primaryBtnClass} onClick={onSaveBusiness} disabled={updateCompany.isPending}>
              {updateCompany.isPending ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-5">
          <h2 className="text-lg font-semibold text-white">Which departments do you want to staff?</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            {DEPARTMENTS.map((dept) => (
              <ToggleCard key={dept} checked={departments.includes(dept)} onChange={() => toggleDepartment(dept)}>
                <span className="text-sm font-medium text-zinc-200">{formatDepartment(dept)}</span>
              </ToggleCard>
            ))}
          </div>

          <div className="flex justify-between pt-1">
            <button type="button" className={backBtnClass} onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="button"
              className={primaryBtnClass}
              onClick={() => setStep(3)}
              disabled={departments.length === 0}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Choose your AI Employees</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Hire from the roles that match your departments. You can rename each one now or change everything
              later.
            </p>
          </div>

          {availableTemplates.length === 0 ? (
            <p className="text-sm text-zinc-400">No matching roles — go back and pick a department.</p>
          ) : (
            <ul className="space-y-3">
              {availableTemplates.map((t) => {
                const hire = hireFor(t);
                return (
                  <li key={t.role}>
                    <ToggleCard checked={hire.selected} onChange={() => toggleHire(t)}>
                      <span className="flex-1">
                        <span className="block text-sm font-semibold text-white">{t.title}</span>
                        <span className="mt-0.5 block text-sm text-zinc-400">{t.description}</span>
                      </span>
                    </ToggleCard>
                    {hire.selected && (
                      <div className="mt-2 pl-4">
                        <label className="mb-1.5 block text-xs font-medium text-zinc-500">Name</label>
                        <input
                          className={fieldClass}
                          value={hire.name}
                          onChange={(e) => setHireName(t, e.target.value)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {completeOnboarding.isError && (
            <p className="text-sm text-red-400">
              {completeOnboarding.error?.message ?? 'Could not finish onboarding'}
            </p>
          )}

          <div className="flex justify-between pt-1">
            <button type="button" className={backBtnClass} onClick={() => setStep(2)}>
              Back
            </button>
            <button type="button" className={primaryBtnClass} onClick={onFinish} disabled={completeOnboarding.isPending}>
              {completeOnboarding.isPending ? 'Finishing…' : 'Finish & go to dashboard'}
            </button>
          </div>
        </section>
      )}
    </OnboardingShell>
  );
}
