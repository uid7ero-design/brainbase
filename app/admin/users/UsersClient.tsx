'use client';
import { useActionState, useState, useTransition } from 'react';
import { createUser, updateUserRole, deleteUser, resetUserPassword, updateUserDetails } from '@/app/actions/users';
import type { Role } from '@/lib/session';
import {
  Badge,
  Button,
  Dialog,
  Field as AppField,
  FormActions,
  FormError,
  PageHeader,
  TableContainer,
  fieldControlClassName,
  tableStyles,
  toolbarControlClassName,
} from '@/components/ui/app';
// Phase C1.6: ROLES (the create/edit dropdown's selectable options)
// deliberately stays at 4 values — 'analyst' has no defined privilege
// placement (see lib/session.ts's Role comment) and is not something an
// admin can assign through this UI. ROLE_COLORS/ROLE_LABELS are exhaustive
// display maps for an EXISTING user row's role, though, so they need an
// entry for every real Role value or a genuinely-analyst-role user (the DB
// enum can hold one; see lib/session.ts) would render with an undefined
// color/label instead of failing type-checking loudly. Matches the same
// defensive label already used by components/clients/ClientWorkspace.tsx's
// People card for the identical reason.
const ROLES: Role[] = ['super_admin', 'admin', 'manager', 'viewer'];
// Phase D1: role tones are semantic tokens (theme-aware) — super_admin uses
// the product accent instead of the retired #a78bfa violet.
const ROLE_COLORS: Record<Role, string> = {
  super_admin: 'var(--brand-brainbase-accent)',
  admin: 'var(--status-info)',
  manager: 'var(--status-success)',
  viewer: 'var(--text-secondary)',
  analyst: 'var(--text-secondary)',
};
const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
  analyst: 'Analyst',
};

type User = { id: string; username: string; name: string; role: string; created_at: string; organisation_id: string | null; organisation_name: string | null };
type Org = { id: string; name: string; slug: string };

export default function UsersClient({ users, orgs, currentUserId }: { users: User[]; orgs: Org[]; currentUserId: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [isPending, startTransition] = useTransition();

  const [createState, createAction, createPending] = useActionState(createUser, undefined);
  const [editState, editAction, editPending] = useActionState(updateUserDetails, undefined);
  const [resetState, resetAction, resetPending] = useActionState(resetUserPassword, undefined);

  function handleRoleChange(userId: string, role: Role) {
    startTransition(() => updateUserRole(userId, role));
  }

  function handleDelete(user: User) {
    if (!confirm(`Delete user "${user.name}"? This cannot be undone.`)) return;
    startTransition(() => deleteUser(user.id));
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <PageHeader
        title="Users"
        description={`${users.length} user${users.length !== 1 ? 's' : ''}`}
        actions={<Button variant="primary" onClick={() => setShowAdd(true)}>+ Add User</Button>}
      />

      <TableContainer label="Users" minWidth={760}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Username</th>
              <th scope="col">Organisation</th>
              <th scope="col">Role</th>
              <th scope="col" className={tableStyles.actions}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ opacity: isPending ? 0.6 : 1 }}>
                <td className={tableStyles.primary}>
                  {u.name}
                  {u.id === currentUserId && <span style={{ marginLeft: 8 }}><Badge state="active" dot={false}>you</Badge></span>}
                </td>
                <td>{u.username}</td>
                <td>
                  {u.organisation_name
                    ? <a href={`/admin/orgs`} className={tableStyles.link}>{u.organisation_name}</a>
                    : <span className={tableStyles.muted} style={{ fontStyle: 'italic' }}>None</span>}
                </td>
                <td>
                  <select
                    value={u.role}
                    disabled={u.id === currentUserId}
                    onChange={e => handleRoleChange(u.id, e.target.value as Role)}
                    aria-label={`Role for ${u.name}`}
                    className={toolbarControlClassName}
                    style={{ height: 28, color: ROLE_COLORS[u.role as Role] ?? 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    {/* 'analyst' is deliberately excluded from ROLES above
                        (not assignable through this UI — see the comment
                        on ROLES) but IS a real value users.role can hold.
                        Without this row-specific option, an analyst row's
                        bound value would match none of the options above
                        and hit the exact same display bug this fix
                        addresses, silently showing "Super Admin" instead.
                        Appending it only for a row that already holds it
                        keeps it out of every other row's assignable list. */}
                    {u.role === 'analyst' && <option value="analyst">{ROLE_LABELS.analyst}</option>}
                  </select>
                </td>
                <td className={tableStyles.actions}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <Button size="sm" onClick={() => setEditTarget(u)}>Edit</Button>
                    <Button size="sm" onClick={() => setResetTarget(u)}>Reset PW</Button>
                    {u.id !== currentUserId && (
                      <Button size="sm" variant="danger" onClick={() => handleDelete(u)}>Delete</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

      {/* Add User Modal */}
      <Dialog open={showAdd} title="Add User" onClose={() => setShowAdd(false)}>
        <form action={async (fd) => { await createAction(fd); if (!createState?.error) setShowAdd(false); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <TextField label="Full Name" name="name" />
          <TextField label="Username" name="username" />
          <TextField label="Password" name="password" type="password" />
          <AppField label="Organisation" required>
            {control => (
              <select {...control} name="orgId" required className={fieldControlClassName}>
                <option value="">— Select organisation —</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name} ({o.slug})</option>)}
              </select>
            )}
          </AppField>
          <AppField label="Role">
            {control => (
              <select {...control} name="role" defaultValue="viewer" className={fieldControlClassName}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            )}
          </AppField>
          {createState?.error && <FormError>{createState.error}</FormError>}
          {createState?.success && <p style={successStyle} role="status">{createState.success}</p>}
          <FormActions align="stretch">
            <Button type="submit" variant="primary" disabled={createPending}>{createPending ? 'Creating…' : 'Create User'}</Button>
          </FormActions>
        </form>
      </Dialog>

      {/* Edit User Modal */}
      <Dialog open={editTarget !== null} title={editTarget ? `Edit — ${editTarget.name}` : 'Edit user'} onClose={() => setEditTarget(null)}>
        {editTarget && (
          <form action={async (fd) => { await editAction(fd); if (!editState?.error) setEditTarget(null); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input type="hidden" name="userId" value={editTarget.id} />
            <TextField label="Full Name" name="name" defaultValue={editTarget.name} />
            <TextField label="Username" name="username" defaultValue={editTarget.username} />
            {editState?.error && <FormError>{editState.error}</FormError>}
            {editState?.success && <p style={successStyle} role="status">{editState.success}</p>}
            <FormActions align="stretch">
              <Button type="submit" variant="primary" disabled={editPending}>{editPending ? 'Saving…' : 'Save changes'}</Button>
            </FormActions>
          </form>
        )}
      </Dialog>

      {/* Reset Password Modal */}
      <Dialog open={resetTarget !== null} title={resetTarget ? `Reset password — ${resetTarget.name}` : 'Reset password'} onClose={() => setResetTarget(null)}>
        {resetTarget && (
          <form action={async (fd) => { await resetAction(fd); if (!resetState?.error) setResetTarget(null); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input type="hidden" name="userId" value={resetTarget.id} />
            <TextField label="New Password" name="password" type="password" />
            {resetState?.error && <FormError>{resetState.error}</FormError>}
            {resetState?.success && <p style={successStyle} role="status">{resetState.success}</p>}
            <FormActions align="stretch">
              <Button type="submit" variant="primary" disabled={resetPending}>{resetPending ? 'Saving…' : 'Update Password'}</Button>
            </FormActions>
          </form>
        )}
      </Dialog>
    </div>
  );
}

function TextField({ label, name, type = 'text', defaultValue }: { label: string; name: string; type?: string; defaultValue?: string }) {
  return (
    <AppField label={label} required>
      {control => (
        <input {...control} name={name} type={type} required defaultValue={defaultValue} className={fieldControlClassName} />
      )}
    </AppField>
  );
}

const successStyle: React.CSSProperties = { color: 'var(--status-success)', fontSize: 13, background: 'var(--status-success-muted)', border: '1px solid var(--status-success-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', margin: 0 };
