'use client';

import type { ToolCallDto } from '@vaep/types';

/** Renders the skill/tool actions an employee took during a run (chat metadata). */
export function ToolCallsPanel({ toolCalls }: { toolCalls: ToolCallDto[] }) {
  if (!toolCalls || toolCalls.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1 rounded-md border border-gray-100 bg-gray-50 p-3 text-xs">
      <p className="mb-1 font-medium text-gray-500">Actions taken</p>
      <ul className="space-y-1">
        {toolCalls.map((call, i) => (
          <li
            key={`${call.skillKey}-${call.tool}-${i}`}
            className="rounded border border-gray-100 bg-white p-2"
          >
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <span className="font-medium text-gray-600">
                {call.skillKey} · {call.tool}
              </span>
              <span
                className={`inline-block rounded-full px-2 py-0.5 font-medium ${
                  call.pendingApproval
                    ? 'bg-amber-100 text-amber-700'
                    : call.ok
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                {call.pendingApproval
                  ? 'awaiting approval'
                  : call.ok
                    ? 'ok'
                    : 'failed'}
              </span>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-gray-500">
              {JSON.stringify(call.result ?? call.args)}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
