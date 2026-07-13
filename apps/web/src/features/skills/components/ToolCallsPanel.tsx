'use client';

import type { ToolCallDto } from '@vaep/types';

/** Renders the skill/tool actions an employee took during a run (chat metadata). */
export function ToolCallsPanel({ toolCalls }: { toolCalls: ToolCallDto[] }) {
  if (!toolCalls || toolCalls.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs">
      <p className="mb-1 font-medium text-zinc-400">Actions taken</p>
      <ul className="space-y-1.5">
        {toolCalls.map((call, i) => (
          <li
            key={`${call.skillKey}-${call.tool}-${i}`}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2"
          >
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <span className="font-medium text-zinc-300">
                {call.skillKey} · {call.tool}
              </span>
              <span
                className={`inline-block rounded-full px-2 py-0.5 font-medium ${
                  call.pendingApproval
                    ? 'bg-amber-500/15 text-amber-400'
                    : call.ok
                      ? 'bg-green-500/15 text-green-400'
                      : 'bg-red-500/15 text-red-400'
                }`}
              >
                {call.pendingApproval
                  ? 'awaiting approval'
                  : call.ok
                    ? 'ok'
                    : 'failed'}
              </span>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-zinc-500">
              {JSON.stringify(call.result ?? call.args)}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
