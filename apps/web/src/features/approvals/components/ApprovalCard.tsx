'use client';

import { useState } from 'react';
import type { ApprovalRequestDto } from '@vaep/types';
import { Button } from '@/components/ui/Button';
import {
  useApproveRequest,
  useModifyRequest,
  useRejectRequest,
} from '../hooks';
import { STATUS_STYLES, formatStatus } from '../labels';

/** A single approval request with Approve / Reject / Modify controls. */
export function ApprovalCard({ request }: { request: ApprovalRequestDto }) {
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const modify = useModifyRequest();

  const [editing, setEditing] = useState(false);
  const [argsText, setArgsText] = useState(() =>
    JSON.stringify(request.args, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const isPending = request.status === 'PENDING';
  const isWorkflow = request.kind === 'WORKFLOW';
  const busy = approve.isPending || reject.isPending || modify.isPending;

  const submitModify = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(argsText) as Record<string, unknown>;
    } catch {
      setParseError('Invalid JSON');
      return;
    }
    setParseError(null);
    modify.mutate({ id: request.id, data: { args: parsed } });
    setEditing(false);
  };

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-gray-800">
              {isWorkflow
                ? 'Workflow approval'
                : `${request.skillKey} · ${request.tool}`}
            </p>
            <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {isWorkflow ? 'Workflow' : 'Tool'}
            </span>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[request.status]}`}
            >
              {formatStatus(request.status)}
            </span>
          </div>
          {request.description && (
            <p className="mt-0.5 text-xs text-gray-500">
              {request.description}
            </p>
          )}
          <p className="mt-0.5 text-xs text-gray-400">
            {isWorkflow
              ? `Workflow run ${request.workflowRunId ?? '—'}`
              : request.employeeId
                ? `Employee ${request.employeeId}`
                : 'No employee'}{' '}
            · {new Date(request.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Tool args block: only TOOL-kind requests gate a tool call. */}
      {!isWorkflow &&
        (editing ? (
          <div>
            <textarea
              className="h-40 w-full rounded-md border border-gray-300 p-2 font-mono text-xs"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
            />
            {parseError && (
              <p className="mt-1 text-xs text-red-600">{parseError}</p>
            )}
          </div>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-gray-100 bg-gray-50 p-2 text-xs text-gray-600">
            {JSON.stringify(request.args, null, 2)}
          </pre>
        ))}

      {request.result != null && (
        <div className="mt-2">
          <p className="mb-1 text-xs font-medium text-gray-500">Result</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-gray-100 bg-gray-50 p-2 text-xs text-gray-600">
            {JSON.stringify(request.result, null, 2)}
          </pre>
        </div>
      )}
      {request.note && (
        <p className="mt-2 text-xs text-gray-500">Note: {request.note}</p>
      )}

      {isPending && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button onClick={submitModify} disabled={busy}>
                Save & Approve
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setParseError(null);
                  setArgsText(JSON.stringify(request.args, null, 2));
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => approve.mutate({ id: request.id })}
                disabled={busy}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                onClick={() => reject.mutate({ id: request.id })}
                disabled={busy}
              >
                Reject
              </Button>
              {/* Modify edits tool args — not meaningful for a WORKFLOW approval. */}
              {!isWorkflow && (
                <Button
                  variant="ghost"
                  onClick={() => setEditing(true)}
                  disabled={busy}
                >
                  Modify
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
