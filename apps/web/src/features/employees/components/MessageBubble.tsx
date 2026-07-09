'use client';

import type { MessageDto } from '@vaep/types';
import { SourcesPanel } from './SourcesPanel';

/** A single chat turn. User turns align right; assistant turns show metadata. */
export function MessageBubble({ message }: { message: MessageDto }) {
  const isUser = message.role === 'USER';
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
        {!isUser && message.metadata && (
          <SourcesPanel metadata={message.metadata} />
        )}
      </div>
    </div>
  );
}
