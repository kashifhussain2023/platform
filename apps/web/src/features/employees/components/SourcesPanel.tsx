'use client';

import type { MessageMetadataDto } from '@vaep/types';

/** Renders the runtime metadata for an assistant turn: verdict, plan, citations. */
export function SourcesPanel({ metadata }: { metadata: MessageMetadataDto }) {
  const { plan, sources, validation } = metadata;
  if (!plan?.length && !sources?.length && !validation) {
    return null;
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-gray-100 bg-gray-50 p-3 text-xs">
      {validation && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 font-medium ${
              validation.grounded
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-200 text-gray-600'
            }`}
          >
            {validation.grounded ? 'Grounded' : 'Ungrounded'}
          </span>
          <span className="text-gray-500">
            Confidence {(validation.confidence * 100).toFixed(0)}%
          </span>
          {validation.needsApproval && (
            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
              Needs approval
            </span>
          )}
          {validation.notes && (
            <p className="w-full text-gray-500">{validation.notes}</p>
          )}
        </div>
      )}

      {plan && plan.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-gray-500">Plan</p>
          <ol className="list-decimal space-y-0.5 pl-4 text-gray-600">
            {plan.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {sources && sources.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-gray-500">Sources</p>
          <ul className="space-y-1">
            {sources.map((s, i) => (
              <li
                key={s.chunkId}
                className="rounded border border-gray-100 bg-white p-2"
              >
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="font-medium text-gray-500">
                    [{i + 1}] doc {s.documentId.slice(0, 8)}
                  </span>
                  <span className="font-medium text-brand-700">
                    {(s.score * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="line-clamp-3 text-gray-600">{s.content}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
