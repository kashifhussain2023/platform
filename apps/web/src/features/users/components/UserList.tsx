'use client';

import { Button } from '@/components/ui/Button';
import { useCurrentUser } from '@/features/auth/hooks';
import {
  useCanManageUsers,
  useCurrentRole,
  useDeleteUser,
  useUpdateUser,
  useUsers,
} from '../hooks';
import { ROLE_BADGE, ROLE_LABEL, STATUS_BADGE, STATUS_LABEL } from '../labels';
import { type Role, type UserDto } from '../schemas';

const ADMIN_ASSIGNABLE: Role[] = ['MEMBER', 'ADMIN'];
const OWNER_ASSIGNABLE: Role[] = ['MEMBER', 'ADMIN', 'OWNER'];

/** Company roster: role/status per user, with OWNER/ADMIN-gated mutation controls. */
export function UserList() {
  const { data: users, isLoading, isError, error } = useUsers();
  const { data: me } = useCurrentUser();
  const canManage = useCanManageUsers();
  const callerRole = useCurrentRole();
  const update = useUpdateUser();
  const del = useDeleteUser();

  const meId = me?.user.id;
  const roleOptions = callerRole === 'OWNER' ? OWNER_ASSIGNABLE : ADMIN_ASSIGNABLE;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-500">Loading team…</p>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-red-600">
          {error?.message ?? 'Could not load users'}
        </p>
      </div>
    );
  }

  const rows = users ?? [];

  // A row is editable when the caller can manage, it is not the caller's own
  // row, and the caller has authority over the target (only an OWNER edits an
  // OWNER). Mirrors the server-side guardrails so the UI never offers a no-op.
  const canEditRow = (u: UserDto): boolean =>
    canManage &&
    u.id !== meId &&
    !(u.role === 'OWNER' && callerRole !== 'OWNER');

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3 font-medium">User</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Status</th>
            {canManage && <th className="px-4 py-3 font-medium text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((u) => {
            const editable = canEditRow(u);
            const isSelf = u.id === meId;
            return (
              <tr key={u.id} className="align-middle">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {u.name}
                    {isSelf && (
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>

                <td className="px-4 py-3">
                  {editable ? (
                    <select
                      aria-label={`Role for ${u.name}`}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={u.role}
                      disabled={update.isPending}
                      onChange={(e) =>
                        update.mutate({
                          id: u.id,
                          data: { role: e.target.value as Role },
                        })
                      }
                    >
                      {/* Keep the current role selectable even if outside the
                          assignable set (e.g. an existing OWNER). */}
                      {Array.from(new Set([u.role, ...roleOptions])).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_BADGE[u.role]}`}
                    >
                      {ROLE_LABEL[u.role]}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[u.status]}`}
                  >
                    {STATUS_LABEL[u.status]}
                  </span>
                </td>

                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {editable && (
                        <>
                          <Button
                            variant="ghost"
                            disabled={update.isPending}
                            onClick={() =>
                              update.mutate({
                                id: u.id,
                                data: {
                                  status:
                                    u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                                },
                              })
                            }
                          >
                            {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50"
                            disabled={del.isPending}
                            onClick={() => {
                              if (
                                typeof window !== 'undefined' &&
                                !window.confirm(`Remove ${u.name}?`)
                              ) {
                                return;
                              }
                              del.mutate(u.id);
                            }}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {(update.isError || del.isError) && (
        <p className="border-t border-gray-100 px-4 py-3 text-sm text-red-600">
          {update.error?.message ?? del.error?.message ?? 'Action failed'}
        </p>
      )}
    </div>
  );
}
