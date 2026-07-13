'use client';

import type { MessageMetadataDto } from '@vaep/types';

/** Renders the runtime metadata for an assistant turn: verdict, plan, citations. */
export function SourcesPanel({ metadata }: { metadata: MessageMetadataDto }) {
  const { plan, sources, validation } = metadata;
  if (!plan?.length && !sources?.length && !validation) {
    return null;
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-white/[0.08] bg-black/20 p-3 text-xs">
      {validation && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 font-medium ${
              validation.grounded
                ? 'bg-green-500/15 text-green-400'
                : 'bg-white/[0.06] text-zinc-400'
            }`}
          >
            {validation.grounded ? 'Grounded' : 'Ungrounded'}
          </span>
          <span className="text-zinc-500">
            Confidence {(validation.confidence * 100).toFixed(0)}%
          </span>
          {validation.needsApproval && (
            <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">
              Needs approval
            </span>
          )}
          {validation.notes && (
            <p className="w-full text-zinc-500">{validation.notes}</p>
          )}
        </div>
      )}

      {plan && plan.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-zinc-400">Plan</p>
          <ol className="list-decimal space-y-0.5 pl-4 text-zinc-400">
            {plan.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {sources && sources.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-zinc-400">Sources</p>
          <ul className="space-y-1">
            {sources.map((s, i) => (
              <li
                key={s.chunkId}
                className="rounded-md border border-white/[0.07] bg-white/[0.03] p-2"
              >
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="font-medium text-zinc-500">
                    [{i + 1}] doc {s.documentId.slice(0, 8)}
                  </span>
                  <span className="font-medium text-violet-secondary">
                    {(s.score * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="line-clamp-3 text-zinc-400">{s.content}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
