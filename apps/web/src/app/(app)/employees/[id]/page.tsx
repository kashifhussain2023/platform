'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ChatPanel } from '@/features/employees/components/ChatPanel';
import {
  useConversations,
  useEmployee,
  useStartConversation,
} from '@/features/employees/hooks';
import { formatRole } from '@/features/employees/labels';
import { useSessionStore } from '@/stores/session.store';

export default function EmployeeChatPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const accessToken = useSessionStore((s) => s.accessToken);
  const employeeId = params.id;

  const { data: employee } = useEmployee(employeeId);
  const { data: conversations } = useConversations(employeeId);
  const startConversation = useStartConversation(employeeId);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Client-side route guard.
  useEffect(() => {
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, router]);

  // Default to the most recent conversation once loaded.
  useEffect(() => {
    if (!conversationId && conversations && conversations.length > 0) {
      setConversationId(conversations[0].id);
    }
  }, [conversations, conversationId]);

  if (!accessToken) {
    return null;
  }

  const onStart = () => {
    startConversation.mutate(
      {},
      { onSuccess: (conversation) => setConversationId(conversation.id) },
    );
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {employee ? formatRole(employee.role) : 'Employee'}
          </p>
          <h1 className="text-2xl font-semibold">
            {employee?.name ?? 'Loading…'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={onStart}
            disabled={startConversation.isPending}
          >
            {startConversation.isPending ? 'Starting…' : 'New conversation'}
          </Button>
          <Link href="/employees" className="text-sm font-medium text-brand-700">
            ← Employees
          </Link>
        </div>
      </header>

      {conversationId && employee ? (
        <ChatPanel conversationId={conversationId} employee={employee} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="mb-4 text-sm text-gray-600">
            {conversations && conversations.length === 0
              ? 'No conversations yet.'
              : 'Loading conversation…'}
          </p>
          <Button onClick={onStart} disabled={startConversation.isPending}>
            {startConversation.isPending ? 'Starting…' : 'Start a conversation'}
          </Button>
        </div>
      )}
    </main>
  );
}
