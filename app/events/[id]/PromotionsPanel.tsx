'use client';

import { useEffect, useState } from 'react';
import {
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  Panel, SectionHeader, EmptyState, StatusBadge,
  primaryBtnStyle, secondaryBtnStyle, fieldStyle, inputStyle, rowCardStyle,
} from '../_components/ui';

// Phase 4 — organiser management of promotional codes and presale access
// codes. Two small panels on the existing event detail page (not a new
// page, not a reporting feature), following the Sessions/Ticket Types
// panels' own create-form + row-list + canManage pattern. Viewers see the
// lists read-only; managers create, edit and disable. There is no delete
// (a used code is part of order history) — "Disable" is PATCH
// { active: false }. All validation shown here is UX only; the API
// re-validates everything (lib/events/validation.ts).

export type PanelTicketType = { id: string; name: string; requires_access_code?: boolean };

type PromotionRow = {
  id: string; code: string; discount_type: 'PERCENT' | 'FIXED'; discount_value: number; active: boolean;
  starts_at: string | null; ends_at: string | null; max_redemptions: number | null; min_cart_cents: number | null;
  ticket_type_ids: string[]; redeemed_count: number; pending_count: number;
};
type AccessCodeRow = {
  id: string; code: string; active: boolean; starts_at: string | null; ends_at: string | null;
  ticket_type_ids: string[]; order_count: number;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
function formatInstant(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
}
function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
// Mirrors lib/events/saleWindow.ts's half-open rule for a code's own window.
function windowState(row: { active: boolean; starts_at: string | null; ends_at: string | null }): { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' } {
  if (!row.active) return { label: 'Disabled', tone: 'neutral' };
  const now = Date.now();
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return { label: 'Scheduled', tone: 'warning' };
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return { label: 'Expired', tone: 'neutral' };
  return { label: 'Active', tone: 'success' };
}
function describeDiscount(p: PromotionRow): string {
  return p.discount_type === 'PERCENT' ? `${p.discount_value}% off` : `${formatMoney(p.discount_value)} off`;
}
function describeTicketTypes(ids: string[], ticketTypes: PanelTicketType[], allLabel: string): string {
  if (!ids.length) return allLabel;
  return ids.map(id => ticketTypes.find(t => t.id === id)?.name ?? 'Unknown ticket type').join(', ');
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error ?? fallback;
}

// ─── Promotional codes ───────────────────────────────────────────────

export function PromotionsPanel({ eventId, ticketTypes, canManage, timezone }: {
  eventId: string; ticketTypes: PanelTicketType[]; canManage: boolean; timezone: string;
}) {
  const [rows, setRows] = useState<PromotionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      const res = await fetch(`/api/events/${eventId}/promotions`);
      if (!res.ok) {
        if (!cancelled) setError(await readError(res, `Failed to load promotional codes (${res.status}).`));
        return;
      }
      const body = await res.json();
      if (!cancelled) setRows(body.promotions ?? []);
    })();
    return () => { cancelled = true; };
  }, [eventId, reloadKey]);

  async function setActive(row: PromotionRow, active: boolean) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/promotions/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
      });
      if (!res.ok) { setError(await readError(res, `Failed to update code (${res.status}).`)); return; }
      reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel style={{ marginTop: 20 }}>
      <SectionHeader
        title="Promotional Codes"
        sub="One code per order. Discounts are calculated and recorded by BrainBase at checkout; changing a code never alters an existing order."
        action={canManage && <button onClick={() => setShowCreate(v => !v)} style={secondaryBtnStyle}>{showCreate ? 'Cancel' : '+ Add Promotional Code'}</button>}
      />
      {error && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12, marginBottom: 10 }}>{error}</div>}

      {showCreate && (
        <div style={{ marginBottom: 10 }}>
          <PromotionForm
            ticketTypes={ticketTypes}
            onCancel={() => setShowCreate(false)}
            onSubmit={async values => {
              const res = await fetch(`/api/events/${eventId}/promotions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setShowCreate(false); reload(); }
              return res;
            }}
          />
        </div>
      )}

      {rows === null && !error && <div style={{ fontSize: 12, color: TEXT_MUTED }}>Loading…</div>}
      {rows && rows.length === 0 && !showCreate && (
        <EmptyState title="No promotional codes yet" body="Add a percentage or fixed-amount code to offer a discount at checkout." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows?.map(p => editingId === p.id ? (
          <PromotionForm
            key={p.id}
            initial={p}
            ticketTypes={ticketTypes}
            onCancel={() => setEditingId(null)}
            onSubmit={async values => {
              const res = await fetch(`/api/events/${eventId}/promotions/${p.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setEditingId(null); reload(); }
              return res;
            }}
          />
        ) : (
          <div key={p.id} className="bb-evt-row" style={rowCardStyle} data-testid={`promotion-${p.id}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: TEXT_PRIMARY, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{p.code}</span>
                  <StatusBadge label={windowState(p).label} tone={windowState(p).tone} />
                  <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{describeDiscount(p)}</span>
                </div>
                <div style={{ marginTop: 5, fontSize: 12, color: TEXT_SECONDARY }}>
                  Applies to: {describeTicketTypes(p.ticket_type_ids, ticketTypes, 'all paid ticket types')}
                  {p.min_cart_cents ? ` · minimum cart ${formatMoney(p.min_cart_cents)}` : ''}
                  {p.starts_at ? ` · from ${formatInstant(p.starts_at, timezone)}` : ''}
                  {p.ends_at ? ` · until ${formatInstant(p.ends_at, timezone)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <StatusBadge
                  label={`${p.redeemed_count} redeemed${p.pending_count ? ` · ${p.pending_count} pending` : ''}${p.max_redemptions !== null ? ` / ${p.max_redemptions}` : ''}`}
                  tone={p.max_redemptions !== null && p.redeemed_count + p.pending_count >= p.max_redemptions ? 'danger' : 'neutral'}
                />
                {canManage && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingId(p.id)} style={secondaryBtnStyle} disabled={busyId === p.id}>Edit</button>
                    <button onClick={() => setActive(p, !p.active)} style={secondaryBtnStyle} disabled={busyId === p.id} aria-label={`${p.active ? 'Disable' : 'Enable'} promotional code ${p.code}`}>
                      {p.active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

type PromotionFormValues = {
  code: string; discount_type: 'PERCENT' | 'FIXED'; discount_value: number; active: boolean;
  starts_at: string | null; ends_at: string | null; max_redemptions: number | null; min_cart_cents: number | null; ticket_type_ids: string[];
};

function PromotionForm({ initial, ticketTypes, onSubmit, onCancel }: {
  initial?: PromotionRow; ticketTypes: PanelTicketType[]; onSubmit: (values: PromotionFormValues) => Promise<Response>; onCancel: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED'>(initial?.discount_type ?? 'PERCENT');
  const [value, setValue] = useState(initial ? (initial.discount_type === 'PERCENT' ? String(initial.discount_value) : (initial.discount_value / 100).toFixed(2)) : '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.ends_at ?? null));
  const [maxRedemptions, setMaxRedemptions] = useState(initial?.max_redemptions !== null && initial?.max_redemptions !== undefined ? String(initial.max_redemptions) : '');
  const [minCart, setMinCart] = useState(initial?.min_cart_cents ? (initial.min_cart_cents / 100).toFixed(2) : '');
  const [selected, setSelected] = useState<string[]>(initial?.ticket_type_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const discountValue = discountType === 'PERCENT' ? Number(value) : Math.round(Number(value) * 100);
    if (!Number.isInteger(discountValue) || discountValue < 1) {
      setError(discountType === 'PERCENT' ? 'Enter a whole percentage between 1 and 100.' : 'Enter a fixed amount of at least $0.01.');
      return;
    }
    setSaving(true);
    try {
      const res = await onSubmit({
        code: code.trim().toUpperCase(), discount_type: discountType, discount_value: discountValue, active,
        starts_at: fromLocalInput(startsAt), ends_at: fromLocalInput(endsAt),
        max_redemptions: maxRedemptions === '' ? null : Number(maxRedemptions),
        min_cart_cents: minCart === '' ? null : Math.round(Number(minCart) * 100),
        ticket_type_ids: selected,
      });
      if (!res.ok) setError(await readError(res, `Failed to save (${res.status}).`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...rowCardStyle, display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={initial ? `Edit promotional code ${initial.code}` : 'New promotional code'}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Code<input required className="bb-evt-input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} style={{ ...inputStyle, textTransform: 'uppercase' }} minLength={3} maxLength={32} pattern="[A-Za-z0-9_\-]{3,32}" title="3–32 letters, numbers, hyphens or underscores" /></label>
        <label style={fieldStyle}>Type
          <select className="bb-evt-input" value={discountType} onChange={e => setDiscountType(e.target.value as 'PERCENT' | 'FIXED')} style={inputStyle}>
            <option value="PERCENT">Percentage</option>
            <option value="FIXED">Fixed amount</option>
          </select>
        </label>
        <label style={fieldStyle}>{discountType === 'PERCENT' ? 'Percent off (1–100)' : 'Amount off (AUD)'}
          <input required type="number" className="bb-evt-input" value={value} onChange={e => setValue(e.target.value)} style={inputStyle}
            min={discountType === 'PERCENT' ? 1 : 0.01} max={discountType === 'PERCENT' ? 100 : undefined} step={discountType === 'PERCENT' ? 1 : 0.01} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Starts (optional)<input type="datetime-local" className="bb-evt-input" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Expires (optional)<input type="datetime-local" className="bb-evt-input" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Max redemptions (optional)<input type="number" min={1} className="bb-evt-input" value={maxRedemptions} onChange={e => setMaxRedemptions(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Minimum cart AUD (optional)<input type="number" min={0.01} step="0.01" className="bb-evt-input" value={minCart} onChange={e => setMinCart(e.target.value)} style={inputStyle} /></label>
      </div>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ ...fieldStyle, marginBottom: 6 }}>Applies to ticket types (none selected = all paid ticket types)</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {ticketTypes.map(t => (
            <label key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT_PRIMARY }}>
              <input type="checkbox" checked={selected.includes(t.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, t.id] : prev.filter(id => id !== t.id))} />
              {t.name}
            </label>
          ))}
          {ticketTypes.length === 0 && <span style={{ fontSize: 12, color: TEXT_MUTED }}>Add ticket types first to restrict a code.</span>}
        </div>
      </fieldset>
      <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
      </label>
      {error && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Access codes ────────────────────────────────────────────────────

export function AccessCodesPanel({ eventId, ticketTypes, canManage, timezone }: {
  eventId: string; ticketTypes: PanelTicketType[]; canManage: boolean; timezone: string;
}) {
  const [rows, setRows] = useState<AccessCodeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);
  const restrictedTypes = ticketTypes.filter(t => t.requires_access_code);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      const res = await fetch(`/api/events/${eventId}/access-codes`);
      if (!res.ok) {
        if (!cancelled) setError(await readError(res, `Failed to load access codes (${res.status}).`));
        return;
      }
      const body = await res.json();
      if (!cancelled) setRows(body.access_codes ?? []);
    })();
    return () => { cancelled = true; };
  }, [eventId, reloadKey]);

  async function setActive(row: AccessCodeRow, active: boolean) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/access-codes/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
      });
      if (!res.ok) { setError(await readError(res, `Failed to update code (${res.status}).`)); return; }
      reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel style={{ marginTop: 20 }}>
      <SectionHeader
        title="Access Codes"
        sub="Presale access. An access code lets a buyer purchase ticket types marked “Requires access code”; it never changes a price or adds capacity."
        action={canManage && <button onClick={() => setShowCreate(v => !v)} style={secondaryBtnStyle}>{showCreate ? 'Cancel' : '+ Add Access Code'}</button>}
      />
      {restrictedTypes.length === 0 && rows && rows.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--status-warning)', marginBottom: 10 }}>
          No ticket type currently requires an access code — mark one in Ticket Types for these codes to have an effect.
        </div>
      )}
      {error && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12, marginBottom: 10 }}>{error}</div>}

      {showCreate && (
        <div style={{ marginBottom: 10 }}>
          <AccessCodeForm
            ticketTypes={ticketTypes}
            onCancel={() => setShowCreate(false)}
            onSubmit={async values => {
              const res = await fetch(`/api/events/${eventId}/access-codes`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setShowCreate(false); reload(); }
              return res;
            }}
          />
        </div>
      )}

      {rows === null && !error && <div style={{ fontSize: 12, color: TEXT_MUTED }}>Loading…</div>}
      {rows && rows.length === 0 && !showCreate && (
        <EmptyState title="No access codes yet" body="Add a code (at least 8 characters) and mark the ticket types it unlocks." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows?.map(a => editingId === a.id ? (
          <AccessCodeForm
            key={a.id}
            initial={a}
            ticketTypes={ticketTypes}
            onCancel={() => setEditingId(null)}
            onSubmit={async values => {
              const res = await fetch(`/api/events/${eventId}/access-codes/${a.id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setEditingId(null); reload(); }
              return res;
            }}
          />
        ) : (
          <div key={a.id} className="bb-evt-row" style={rowCardStyle} data-testid={`access-code-${a.id}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: TEXT_PRIMARY, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{a.code}</span>
                  <StatusBadge label={windowState(a).label} tone={windowState(a).tone} />
                </div>
                <div style={{ marginTop: 5, fontSize: 12, color: TEXT_SECONDARY }}>
                  Unlocks: {describeTicketTypes(a.ticket_type_ids, ticketTypes, 'every ticket type that requires an access code')}
                  {a.starts_at ? ` · from ${formatInstant(a.starts_at, timezone)}` : ''}
                  {a.ends_at ? ` · until ${formatInstant(a.ends_at, timezone)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <StatusBadge label={`${a.order_count} order${a.order_count === 1 ? '' : 's'}`} tone="neutral" />
                {canManage && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingId(a.id)} style={secondaryBtnStyle} disabled={busyId === a.id}>Edit</button>
                    <button onClick={() => setActive(a, !a.active)} style={secondaryBtnStyle} disabled={busyId === a.id} aria-label={`${a.active ? 'Disable' : 'Enable'} access code ${a.code}`}>
                      {a.active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

type AccessCodeFormValues = { code: string; active: boolean; starts_at: string | null; ends_at: string | null; ticket_type_ids: string[] };

function AccessCodeForm({ initial, ticketTypes, onSubmit, onCancel }: {
  initial?: AccessCodeRow; ticketTypes: PanelTicketType[]; onSubmit: (values: AccessCodeFormValues) => Promise<Response>; onCancel: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.ends_at ?? null));
  const [selected, setSelected] = useState<string[]>(initial?.ticket_type_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await onSubmit({
        code: code.trim().toUpperCase(), active, starts_at: fromLocalInput(startsAt), ends_at: fromLocalInput(endsAt), ticket_type_ids: selected,
      });
      if (!res.ok) setError(await readError(res, `Failed to save (${res.status}).`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...rowCardStyle, display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={initial ? `Edit access code ${initial.code}` : 'New access code'}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Code (8–32 characters)<input required className="bb-evt-input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} style={{ ...inputStyle, textTransform: 'uppercase' }} minLength={8} maxLength={32} pattern="[A-Za-z0-9_\-]{8,32}" title="8–32 letters, numbers, hyphens or underscores" /></label>
        <label style={fieldStyle}>Starts (optional)<input type="datetime-local" className="bb-evt-input" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} /></label>
        <label style={fieldStyle}>Expires (optional)<input type="datetime-local" className="bb-evt-input" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} /></label>
      </div>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ ...fieldStyle, marginBottom: 6 }}>Unlocks ticket types (none selected = every ticket type that requires an access code)</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {ticketTypes.map(t => (
            <label key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT_PRIMARY }}>
              <input type="checkbox" checked={selected.includes(t.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, t.id] : prev.filter(id => id !== t.id))} />
              {t.name}{t.requires_access_code ? '' : <span style={{ color: TEXT_MUTED }}> (not restricted)</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
      </label>
      {error && <div role="alert" style={{ color: 'var(--status-danger)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}
