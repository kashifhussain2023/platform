'use client';

import { useState } from 'react';
import type { SlotStatus } from '@vaep/types';
import { useSlots } from '../hooks';
import { SlotCard } from './SlotCard';

const TABS: SlotStatus[] = ['BOOKED', 'OPEN', 'CANCELLED'];

/** Slots grouped by status: Booked (with Reschedule), Open (with Cancel), Cancelled. */
export function SlotList() {
  const [tab, setTab] = useState<SlotStatus>('BOOKED');
  const { data: slots, isLoading } = useSlots(tab);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-violet text-white'
                : 'bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-200'
            }`}
          >
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading slots…</p>
      ) : !slots || slots.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {tab === 'BOOKED'
            ? 'No booked interviews yet.'
            : tab === 'OPEN'
              ? 'No open slots. Generate a pattern or add a custom one above.'
              : 'No cancelled slots.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {slots.map((slot) => (
            <SlotCard key={slot.id} slot={slot} />
          ))}
        </ul>
      )}
    </div>
  );
}
