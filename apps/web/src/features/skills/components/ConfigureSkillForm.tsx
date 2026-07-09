'use client';

import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { useConfigureSkill } from '../hooks';
import { configureSkillSchema } from '../schemas';
import type { ConfigFieldDto, InstalledSkillDto, SkillDefinitionDto } from '../schemas';

const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

/** Initial value for a field from the stored config (secrets stay blank). */
function initial(field: ConfigFieldDto, config: Record<string, unknown> | null) {
  if (field.secret) return field.type === 'boolean' ? false : '';
  const v = config?.[field.key];
  if (field.type === 'boolean') return Boolean(v);
  return v == null ? '' : String(v);
}

/**
 * Data-driven configuration form rendered from a skill's `configSchema`. Each
 * field type maps to an input (string/number/textarea/select/boolean; secrets →
 * password). Coerces + validates with the shared zod contract, then PATCHes
 * .../config (optimistic).
 */
export function ConfigureSkillForm({
  installed,
  def,
  onDone,
}: {
  installed: InstalledSkillDto;
  def: SkillDefinitionDto;
  onDone?: () => void;
}) {
  const configure = useConfigureSkill();
  const fields = def.configSchema ?? [];
  const { register, handleSubmit } = useForm<Record<string, unknown>>({
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.key, initial(f, installed.config)]),
    ),
  });

  const onSubmit = handleSubmit((values) => {
    // Coerce values by field type; drop empty (untouched) optional strings.
    const config: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = values[field.key];
      if (field.type === 'boolean') {
        config[field.key] = Boolean(raw);
      } else if (field.type === 'number') {
        if (raw === '' || raw == null) continue;
        config[field.key] = Number(raw);
      } else {
        if (raw === '' || raw == null) continue;
        config[field.key] = raw;
      }
    }
    const parsed = configureSkillSchema.parse({ config });
    configure.mutate(
      { id: installed.id, data: parsed },
      { onSuccess: () => onDone?.() },
    );
  });

  if (fields.length === 0) {
    return (
      <p className="text-xs text-gray-500">This skill has no configuration.</p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `cfg-${installed.id}-${field.key}`;
          return (
            <div
              key={field.key}
              className={field.type === 'textarea' ? 'sm:col-span-2' : ''}
            >
              {field.type === 'boolean' ? (
                <label htmlFor={id} className="flex items-center gap-2 text-sm">
                  <input id={id} type="checkbox" {...register(field.key)} />
                  {field.label}
                </label>
              ) : (
                <>
                  <label htmlFor={id} className="mb-1 block text-sm font-medium">
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      id={id}
                      className={inputClass}
                      rows={3}
                      placeholder={field.placeholder}
                      {...register(field.key)}
                    />
                  ) : field.type === 'select' ? (
                    <select id={id} className={inputClass} {...register(field.key)}>
                      <option value="">Select…</option>
                      {(field.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type={
                        field.secret
                          ? 'password'
                          : field.type === 'number'
                            ? 'number'
                            : 'text'
                      }
                      className={inputClass}
                      placeholder={field.placeholder}
                      {...register(field.key)}
                    />
                  )}
                </>
              )}
              {field.help && (
                <p className="mt-1 text-xs text-gray-400">{field.help}</p>
              )}
            </div>
          );
        })}
      </div>

      {configure.isError && (
        <p className="text-sm text-red-600">
          {configure.error?.message ?? 'Could not save configuration'}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={configure.isPending}>
          {configure.isPending ? 'Saving…' : 'Save configuration'}
        </Button>
        {configure.isSuccess && !configure.isPending && (
          <span className="text-sm text-green-600">Saved.</span>
        )}
      </div>
    </form>
  );
}
