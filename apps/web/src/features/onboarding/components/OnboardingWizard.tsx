'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Department, EmployeeRoleTemplate } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useUpdateCompany } from '@/features/tenant/hooks';
import { useCompleteOnboarding, useOnboardingCatalog } from '../hooks';
import { COMPANY_SIZES, formatDepartment } from '../labels';
import { DEPARTMENTS } from '../schemas';

interface HireState {
  selected: boolean;
  name: string;
}

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

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
    return catalog.filter((t) =>
      t.departments.some((d) => departments.includes(d)),
    );
  }, [catalog, departments]);

  const toggleDepartment = (dept: Department) => {
    setDepartments((prev) =>
      prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept],
    );
  };

  const hireFor = (t: EmployeeRoleTemplate): HireState =>
    hires[t.role] ?? { selected: false, name: t.suggestedName };

  const toggleHire = (t: EmployeeRoleTemplate) => {
    setHires((prev) => {
      const current = prev[t.role] ?? {
        selected: false,
        name: t.suggestedName,
      };
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
      .map((t) => ({
        role: t.role,
        name: hireFor(t).name.trim() || t.suggestedName,
      }));

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

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-brand-700">
          Welcome to AI Employee
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          Let&apos;s set up your AI workforce
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          A few quick steps and your first AI employees will be ready to work.
        </p>
      </header>

      {/* Stepper */}
      <ol className="flex items-center gap-2 text-xs font-medium">
        {[
          { n: 1, label: 'Business' },
          { n: 2, label: 'Departments' },
          { n: 3, label: 'AI Employees' },
        ].map(({ n, label }) => (
          <li
            key={n}
            className={`flex items-center gap-2 rounded-full px-3 py-1 ${
              step === n
                ? 'bg-brand-600 text-white'
                : step > n
                  ? 'bg-brand-50 text-brand-700'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            <span>{n}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-medium">Tell us about your business</h2>
          <div>
            <label htmlFor="industry" className="mb-1 block text-sm font-medium">
              Industry
            </label>
            <input
              id="industry"
              className={inputClass}
              placeholder="e.g. SaaS, Retail, Healthcare"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="size" className="mb-1 block text-sm font-medium">
              Company size
            </label>
            <select
              id="size"
              className={inputClass}
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
          </div>
          <div>
            <label
              htmlFor="description"
              className="mb-1 block text-sm font-medium"
            >
              What does your company do?{' '}
              <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="description"
              rows={3}
              className={inputClass}
              placeholder="A short description helps your AI employees understand your business."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {updateCompany.isError && (
            <p className="text-sm text-red-600">
              {updateCompany.error?.message ?? 'Could not save your business'}
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={onSaveBusiness} disabled={updateCompany.isPending}>
              {updateCompany.isPending ? 'Saving…' : 'Continue'}
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-medium">
            Which departments do you want to staff?
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {DEPARTMENTS.map((dept) => (
              <label
                key={dept}
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-sm ${
                  departments.includes(dept)
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={departments.includes(dept)}
                  onChange={() => toggleDepartment(dept)}
                />
                {formatDepartment(dept)}
              </label>
            ))}
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={departments.length === 0}
            >
              Continue
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-medium">Choose your AI Employees</h2>
          <p className="text-sm text-gray-500">
            Hire from the roles that match your departments. You can rename each
            one now or change everything later.
          </p>
          {availableTemplates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No matching roles — go back and pick a department.
            </p>
          ) : (
            <ul className="space-y-3">
              {availableTemplates.map((t) => {
                const hire = hireFor(t);
                return (
                  <li
                    key={t.role}
                    className={`rounded-md border px-4 py-3 ${
                      hire.selected ? 'border-brand-500 bg-brand-50' : 'border-gray-300'
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={hire.selected}
                        onChange={() => toggleHire(t)}
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">
                          {t.title}
                        </span>
                        <span className="block text-sm text-gray-500">
                          {t.description}
                        </span>
                      </span>
                    </label>
                    {hire.selected && (
                      <div className="mt-3 pl-7">
                        <label className="mb-1 block text-xs font-medium text-gray-500">
                          Name
                        </label>
                        <input
                          className={inputClass}
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
            <p className="text-sm text-red-600">
              {completeOnboarding.error?.message ?? 'Could not finish onboarding'}
            </p>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={onFinish} disabled={completeOnboarding.isPending}>
              {completeOnboarding.isPending ? 'Finishing…' : 'Finish & go to dashboard'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
