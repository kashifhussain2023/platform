'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { useCanManageOrg, useSecurityPolicy, useUpdateSecurityPolicy } from '../hooks';
import {
  updateSecurityPolicySchema,
  type SecurityPolicyDto,
  type UpdateSecurityPolicyDto,
} from '../schemas';

const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

/** Empty string / null / undefined → undefined; otherwise a Number. */
const numOrUndef = (v: unknown): number | undefined =>
  v === '' || v === null || v === undefined ? undefined : Number(v);

/** The editable form, keyed on the loaded policy so defaults initialize once. */
function PolicyForm({
  policy,
  canManage,
}: {
  policy: SecurityPolicyDto;
  canManage: boolean;
}) {
  const update = useUpdateSecurityPolicy();
  const [newDomain, setNewDomain] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<UpdateSecurityPolicyDto>({
    resolver: zodResolver(updateSecurityPolicySchema),
    defaultValues: {
      passwordMinLength: policy.passwordMinLength,
      mfaRequired: policy.mfaRequired,
      sessionTimeoutMinutes: policy.sessionTimeoutMinutes,
      allowedEmailDomains: policy.allowedEmailDomains,
      dataRetentionDays: policy.dataRetentionDays,
    },
  });

  const domains = watch('allowedEmailDomains') ?? [];

  const addDomain = () => {
    const d = newDomain.trim().toLowerCase();
    if (!d || domains.includes(d)) {
      setNewDomain('');
      return;
    }
    setValue('allowedEmailDomains', [...domains, d].slice(0, 100), {
      shouldDirty: true,
    });
    setNewDomain('');
  };
  const removeDomain = (idx: number) => {
    setValue(
      'allowedEmailDomains',
      domains.filter((_, i) => i !== idx),
      { shouldDirty: true },
    );
  };

  const onSubmit = handleSubmit((values) => {
    update.mutate(values);
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="sp-minlen" className="mb-1 block text-sm font-medium">
            Password min length
          </label>
          <input
            id="sp-minlen"
            type="number"
            min={8}
            max={128}
            className={inputClass}
            disabled={!canManage}
            {...register('passwordMinLength', { setValueAs: numOrUndef })}
          />
          {errors.passwordMinLength && (
            <p className="mt-1 text-sm text-red-600">
              {errors.passwordMinLength.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="sp-session" className="mb-1 block text-sm font-medium">
            Session timeout (min)
          </label>
          <input
            id="sp-session"
            type="number"
            min={0}
            className={inputClass}
            disabled={!canManage}
            {...register('sessionTimeoutMinutes', { setValueAs: numOrUndef })}
          />
          <p className="mt-1 text-xs text-gray-400">0 = no timeout (stored only)</p>
        </div>
        <div>
          <label htmlFor="sp-retention" className="mb-1 block text-sm font-medium">
            Data retention (days)
          </label>
          <input
            id="sp-retention"
            type="number"
            min={0}
            className={inputClass}
            disabled={!canManage}
            {...register('dataRetentionDays', { setValueAs: numOrUndef })}
          />
          <p className="mt-1 text-xs text-gray-400">0 = keep forever (stored only)</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={!canManage} {...register('mfaRequired')} />
        Require MFA <span className="text-gray-400">(stored only)</span>
      </label>

      <fieldset className="rounded-md border border-gray-200 p-4">
        <legend className="px-1 text-xs font-medium text-gray-500">
          Allowed email domains
        </legend>
        <p className="mb-3 text-xs text-gray-400">
          When set, new users (POST /users) must have an email in one of these
          domains. Empty = no restriction.
        </p>
        {domains.length > 0 ? (
          <ul className="mb-3 flex flex-wrap gap-2">
            {domains.map((d, i) => (
              <li
                key={`${d}-${i}`}
                className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm"
              >
                <span className="text-gray-800">{d}</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => removeDomain(i)}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-gray-400">No domain restriction.</p>
        )}
        {canManage && (
          <div className="flex items-center gap-2">
            <input
              aria-label="New allowed email domain"
              className={inputClass}
              placeholder="e.g. acme.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDomain();
                }
              }}
            />
            <Button type="button" variant="ghost" onClick={addDomain}>
              Add
            </Button>
          </div>
        )}
      </fieldset>

      {update.isError && (
        <p className="text-sm text-red-600">
          {update.error?.message ?? 'Could not save security policy'}
        </p>
      )}

      {canManage && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending || !isDirty}>
            {update.isPending ? 'Saving…' : 'Save security policy'}
          </Button>
          {update.isSuccess && !update.isPending && (
            <span className="text-sm text-green-600">Saved.</span>
          )}
        </div>
      )}
    </form>
  );
}

/** Security policy section (P1 #7): one policy per company, self-healed on read. */
export function SecurityPolicyForm() {
  const { data: policy, isLoading, isError, error } = useSecurityPolicy();
  const canManage = useCanManageOrg();

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-medium text-gray-500">Security policy</h2>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading security policy…</p>
      ) : isError || !policy ? (
        <p className="text-sm text-red-600">
          {error?.message ?? 'Could not load security policy'}
        </p>
      ) : (
        <PolicyForm key={policy.id} policy={policy} canManage={canManage} />
      )}
    </section>
  );
}
