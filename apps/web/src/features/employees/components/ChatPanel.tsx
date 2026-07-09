'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import type { AiEmployeeDto } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useMessages, useSendMessage } from '../hooks';
import { sendMessageSchema, type SendMessageDto } from '../schemas';
import { MessageBubble } from './MessageBubble';

/** Message list + composer for one conversation with an employee. */
export function ChatPanel({
  conversationId,
  employee,
}: {
  conversationId: string;
  employee: AiEmployeeDto;
}) {
  const { data: messages } = useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SendMessageDto>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: { content: '' },
  });

  // The ONE allowed useRef in this codebase: chat autoscroll anchor.
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const disabled = employee.status !== 'ACTIVE';

  const onSubmit = handleSubmit((values) => {
    send.mutate({ content: values.content }, { onSuccess: () => reset() });
  });

  return (
    <section className="flex h-[70vh] flex-col rounded-lg border border-gray-200 bg-gray-50">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {(messages ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">
            No messages yet. Say hello to get started.
          </p>
        ) : (
          (messages ?? []).map((m) => (
            <MessageBubble key={m.id} message={m} employeeId={employee.id} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-gray-200 p-3"
        noValidate
      >
        {disabled && (
          <p className="mb-2 text-sm text-amber-700">
            This employee is {employee.status.toLowerCase()}. Resume it to chat.
          </p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ask your employee…"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            disabled={disabled || send.isPending}
            {...register('content')}
          />
          <Button type="submit" disabled={disabled || send.isPending}>
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
        {errors.content && (
          <p className="mt-1 text-sm text-red-600">{errors.content.message}</p>
        )}
        {send.isError && (
          <p className="mt-1 text-sm text-red-600">
            {send.error?.message ?? 'Message failed'}
          </p>
        )}
      </form>
    </section>
  );
}
