'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Send } from 'lucide-react';
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
    <section className="flex h-[70vh] flex-col rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {(messages ?? []).length === 0 ? (
          <p className="text-sm text-zinc-500">
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
        className="border-t border-white/[0.07] p-3"
        noValidate
      >
        {disabled && (
          <p className="mb-2 text-sm text-amber-400">
            This employee is {employee.status.toLowerCase()}. Resume it to chat.
          </p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ask your employee…"
            className="field-modern flex-1"
            disabled={disabled || send.isPending}
            {...register('content')}
          />
          <Button variant="violet" type="submit" disabled={disabled || send.isPending}>
            <Send className="h-4 w-4" />
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
        {errors.content && (
          <p className="mt-1 text-sm text-red-400">{errors.content.message}</p>
        )}
        {send.isError && (
          <p className="mt-1 text-sm text-red-400">
            {send.error?.message ?? 'Message failed'}
          </p>
        )}
      </form>
    </section>
  );
}
