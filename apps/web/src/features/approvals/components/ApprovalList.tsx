'use client';

import { useState } from 'react';
import { useApprovals } from '../hooks';
import { ApprovalCard } from './ApprovalCard';

type FilterTab = 'PENDING' | 'ALL';

/** The approval queue: Pending (default) or All, each item Approve/Reject/Modify. */
export function ApprovalList() {
  const [tab, setTab] = useState<FilterTab>('PENDING');
  const { data: requests, isLoading } = useApprovals(
    tab === 'PENDING' ? 'PENDING' : undefined,
  );

  const tabs: FilterTab[] = ['PENDING', 'ALL'];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'PENDING' ? 'Pending' : 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading approvals…</p>
      ) : !requests || requests.length === 0 ? (
        <p className="text-sm text-gray-500">
          {tab === 'PENDING'
            ? 'No pending approvals. High-risk actions will appear here for review.'
            : 'No approval requests yet.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {requests.map((request) => (
            <ApprovalCard key={request.id} request={request} />
          ))}
        </ul>
      )}
    </div>
  );
}
