'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  useEmployeeLearning,
  useEmployeeMemories,
  useForgetMemory,
  useTeachMemory,
} from '../hooks';

const SOURCE_LABELS: Record<string, string> = {
  FEEDBACK: 'from feedback',
  MANUAL: 'taught',
  RUN: 'from a run',
};

/**
 * Learning panel (Step 15): feedback tallies, the durable memories the employee
 * has learned (with Teach a fact / Forget), and recent feedback. Optimistic
 * add/delete of memories.
 */
export function LearningPanel({ employeeId }: { employeeId: string }) {
  const { data: learning } = useEmployeeLearning(employeeId);
  const { data: memories } = useEmployeeMemories(employeeId);
  const teach = useTeachMemory(employeeId);
  const forget = useForgetMemory(employeeId);
  const [fact, setFact] = useState('');

  const onTeach = () => {
    const content = fact.trim();
    if (!content) return;
    teach.mutate({ kind: 'FACT', content }, { onSuccess: () => setFact('') });
  };

  const fb = learning?.feedback;
  const recent = learning?.recentFeedback ?? [];

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <h2 className="mb-4 text-sm font-medium text-white">Learning</h2>

      {/* Feedback summary */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-center">
          <p className="text-lg font-semibold text-green-400">{fb?.up ?? 0}</p>
          <p className="text-xs text-zinc-500">👍 Helpful</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-center">
          <p className="text-lg font-semibold text-red-400">{fb?.down ?? 0}</p>
          <p className="text-xs text-zinc-500">👎 Needs work</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-center">
          <p className="text-lg font-semibold text-white">
            {learning?.memories.total ?? 0}
          </p>
          <p className="text-xs text-zinc-500">Memories</p>
        </div>
      </div>

      {/* Teach a fact */}
      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={fact}
          onChange={(e) => setFact(e.target.value)}
          placeholder="Teach the employee a fact it should remember…"
          className="field-modern"
        />
        <Button
          variant="violet"
          type="button"
          onClick={onTeach}
          disabled={teach.isPending || !fact.trim()}
        >
          {teach.isPending ? 'Teaching…' : 'Teach'}
        </Button>
      </div>

      {/* Memories list */}
      <h3 className="mb-2 text-xs font-medium text-zinc-500">
        What this employee has learned
      </h3>
      {(memories ?? []).length === 0 ? (
        <p className="mb-4 text-sm text-zinc-500">
          Nothing learned yet. Teach a fact or leave feedback in chat.
        </p>
      ) : (
        <ul className="mb-4 space-y-2">
          {(memories ?? []).map((m) => (
            <li
              key={m.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="break-words text-sm text-zinc-200">{m.content}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {m.kind}
                  {m.source ? ` · ${SOURCE_LABELS[m.source] ?? m.source}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-xs text-zinc-500 hover:text-red-400"
                disabled={forget.isPending}
                onClick={() => forget.mutate(m.id)}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Recent feedback */}
      {recent.length > 0 && (
        <>
          <h3 className="mb-2 text-xs font-medium text-zinc-500">
            Recent feedback
          </h3>
          <ul className="space-y-1">
            {recent.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-sm">
                <span>{f.rating === 'UP' ? '👍' : '👎'}</span>
                <span className="text-zinc-400">
                  {f.correction || f.note || (
                    <span className="text-zinc-600">(no note)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
