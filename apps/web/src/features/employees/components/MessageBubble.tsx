'use client';

import { useState } from 'react';
import type { MessageDto } from '@vaep/types';
import { ToolCallsPanel } from '@/features/skills/components/ToolCallsPanel';
import { useSubmitFeedback } from '../hooks';
import { SourcesPanel } from './SourcesPanel';

/**
 * A single chat turn. User turns align right; assistant turns show runtime
 * metadata plus subtle 👍/👎 feedback + a "Teach…" action (Step 15). A 👎 or a
 * taught correction becomes durable employee memory the runtime later recalls.
 */
export function MessageBubble({
  message,
  employeeId,
}: {
  message: MessageDto;
  employeeId: string;
}) {
  const isUser = message.role === 'USER';
  const toolCalls = message.metadata?.toolCalls ?? [];
  const feedback = useSubmitFeedback(employeeId);
  const [rated, setRated] = useState<'UP' | 'DOWN' | null>(null);
  const [teaching, setTeaching] = useState(false);
  const [correction, setCorrection] = useState('');

  // A temp (optimistic) assistant message has no server id yet — don't rate it.
  const canRate = !isUser && !message.id.startsWith('temp_');

  const rate = (rating: 'UP' | 'DOWN') => {
    setRated(rating);
    feedback.mutate({
      conversationId: message.conversationId,
      messageId: message.id,
      rating,
    });
  };

  const submitTeach = () => {
    const text = correction.trim();
    if (!text) return;
    feedback.mutate({
      conversationId: message.conversationId,
      messageId: message.id,
      rating: 'DOWN',
      correction: text,
      teach: true,
    });
    setRated('DOWN');
    setTeaching(false);
    setCorrection('');
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        <div
          className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
            isUser
              ? 'bg-brand-600 text-white'
              : 'border border-gray-200 bg-white text-gray-800'
          }`}
        >
          {message.content}
        </div>
        {!isUser && toolCalls.length > 0 && (
          <ToolCallsPanel toolCalls={toolCalls} />
        )}
        {!isUser && message.metadata && (
          <SourcesPanel metadata={message.metadata} />
        )}

        {canRate && (
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
            <button
              type="button"
              aria-label="Good answer"
              className={`rounded px-1 hover:text-green-600 ${
                rated === 'UP' ? 'text-green-600' : ''
              }`}
              disabled={feedback.isPending}
              onClick={() => rate('UP')}
            >
              👍
            </button>
            <button
              type="button"
              aria-label="Bad answer"
              className={`rounded px-1 hover:text-red-600 ${
                rated === 'DOWN' ? 'text-red-600' : ''
              }`}
              disabled={feedback.isPending}
              onClick={() => rate('DOWN')}
            >
              👎
            </button>
            <button
              type="button"
              className="rounded px-1 hover:text-brand-700"
              onClick={() => setTeaching((t) => !t)}
            >
              Teach…
            </button>
            {rated && !teaching && (
              <span className="text-gray-400">Thanks — noted.</span>
            )}
          </div>
        )}

        {canRate && teaching && (
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder="Teach a correction the employee should remember…"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
            />
            <button
              type="button"
              className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              disabled={feedback.isPending || !correction.trim()}
              onClick={submitTeach}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
