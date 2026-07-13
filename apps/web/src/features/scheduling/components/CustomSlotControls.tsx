'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useAddSlot, useBlockDate } from '../hooks';
import {
  addSlotSchema,
  blockDateSchema,
  type AddSlotDto,
  type BlockDateDto,
} from '../schemas';

const secondaryBtnClass =
  'rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';

/** Exact per-date overrides on top of the recurring pattern: add one slot, or block a date. */
export function CustomSlotControls() {
  const addSlot = useAddSlot();
  const blockDate = useBlockDate();

  const addForm = useForm<AddSlotDto>({
    resolver: zodResolver(addSlotSchema),
    defaultValues: { start: '', end: '' },
  });
  const blockForm = useForm<BlockDateDto>({
    resolver: zodResolver(blockDateSchema),
    defaultValues: { date: '' },
  });

  const onAddSlot = addForm.handleSubmit((values) => {
    addSlot.mutate(values, { onSuccess: () => addForm.reset() });
  });
  const onBlockDate = blockForm.handleSubmit((values) => {
    blockDate.mutate(values, { onSuccess: () => blockForm.reset() });
  });

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
      <h2 className="mb-3 text-sm font-medium text-zinc-400">
        Custom overrides
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form onSubmit={onAddSlot} className="space-y-2" noValidate>
          <p className="text-sm font-medium text-zinc-300">Add one-off slot</p>
          <input type="datetime-local" className="field-modern" {...addForm.register('start')} />
          <input type="datetime-local" className="field-modern" {...addForm.register('end')} />
          {(addForm.formState.errors.start || addForm.formState.errors.end) && (
            <p className="text-sm text-red-400">Start and end are required.</p>
          )}
          {addSlot.isError && (
            <p className="text-sm text-red-400">
              {addSlot.error?.message ?? 'Could not add slot'}
            </p>
          )}
          <button type="submit" className={secondaryBtnClass} disabled={addSlot.isPending}>
            {addSlot.isPending ? 'Adding…' : 'Add slot'}
          </button>
        </form>

        <form onSubmit={onBlockDate} className="space-y-2" noValidate>
          <p className="text-sm font-medium text-zinc-300">Block a date (holiday)</p>
          <input type="date" className="field-modern" {...blockForm.register('date')} />
          {blockForm.formState.errors.date && (
            <p className="text-sm text-red-400">Date is required.</p>
          )}
          {blockDate.isError && (
            <p className="text-sm text-red-400">
              {blockDate.error?.message ?? 'Could not block date'}
            </p>
          )}
          {blockDate.isSuccess && (
            <p className="text-sm text-green-400">
              Cancelled {blockDate.data.cancelled} open slot(s).
            </p>
          )}
          <button type="submit" className={secondaryBtnClass} disabled={blockDate.isPending}>
            {blockDate.isPending ? 'Blocking…' : 'Block date'}
          </button>
        </form>
      </div>
    </section>
  );
}
