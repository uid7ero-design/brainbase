'use client';

// Phase 4B §4 — manager question builder. Self-fetching (unlike
// Sessions/TicketTypes, which receive data the parent already loaded
// via GET /api/events/[id]) since registration questions are their own
// dedicated endpoint (GET/POST /api/events/[id]/questions, PATCH
// /api/events/[id]/questions/[questionId] — see those routes and
// lib/events/registrationQuestions.ts for the validation/tenancy rules
// this UI is a thin client for). No DELETE anywhere in this panel —
// "Deactivate" is the only removal action, matching that route's own
// deliberate absence of a DELETE handler.

import { useEffect, useState, useCallback } from 'react';
import {
  Panel, SectionHeader, EmptyState, StatusBadge, secondaryBtnStyle, primaryBtnStyle,
  DangerButton, fieldStyle, inputStyle, rowCardStyle, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  FilterDropdown, type DropdownOption,
} from '../_components/ui';

const FIELD_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_SELECT', 'MULTI_SELECT'] as const;
type FieldType = typeof FIELD_TYPES[number];
const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  SHORT_TEXT: 'Short text', LONG_TEXT: 'Long text', YES_NO: 'Yes / No',
  SINGLE_SELECT: 'Single choice', MULTI_SELECT: 'Multiple choice',
};
const SCOPES = ['ORDER', 'ATTENDEE'] as const;
type Scope = typeof SCOPES[number];
const SCOPE_LABELS: Record<Scope, string> = { ORDER: 'Once per booking', ATTENDEE: 'Once per attendee' };

type QuestionRow = {
  id: string; label: string; help_text: string | null; field_type: FieldType; required: boolean;
  scope: Scope; options: string[] | null; sort_order: number; active: boolean;
};

// §4 — sensible starter examples, offered as a shortcut that still
// goes through the normal create form (never auto-created for every
// event — see that route's own header comment). Never LD-Tennis or any
// other organisation-specific wording; these are generic enough to be
// reusable across any BrainBase organisation running events.
const COMMON_QUESTIONS: { label: string; field_type: FieldType; scope: Scope }[] = [
  { label: 'Dietary requirements', field_type: 'LONG_TEXT', scope: 'ATTENDEE' },
  { label: 'Accessibility or support requirements', field_type: 'LONG_TEXT', scope: 'ATTENDEE' },
  { label: 'Special requests or anything else we should know?', field_type: 'LONG_TEXT', scope: 'ORDER' },
];

export default function QuestionsPanel({ eventId, canManage }: { eventId: string; canManage: boolean }) {
  const [questions, setQuestions] = useState<QuestionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createTemplate, setCreateTemplate] = useState<{ label: string; field_type: FieldType; scope: Scope } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Inlined directly in the effect (not called out to a separately
  // memoized load() function) — same convention EventDetailClient's own
  // fetch effects already use, avoiding a "call a state-setting
  // function from an effect" lint violation. reload() just bumps
  // reloadKey to re-run this same effect on demand after a mutation.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/questions`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setLoadError(body.error ?? `Failed to load questions (${res.status}).`);
          return;
        }
        const body = await res.json();
        if (!cancelled) setQuestions(body.questions ?? []);
      } catch {
        if (!cancelled) setLoadError('Failed to load questions.');
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reloadKey]);

  async function toggleActive(q: QuestionRow) {
    setActionError(null);
    setBusyId(q.id);
    try {
      const res = await fetch(`/api/events/${eventId}/questions/${q.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !q.active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Failed to update (${res.status}).`);
        return;
      }
      reload();
    } finally {
      setBusyId(null);
    }
  }

  // §4 "reorder" — Phase 4B pre-commit remediation §2: a single request
  // to a dedicated atomic reorder endpoint, replacing the old client-
  // orchestrated "two independent PATCH requests" swap (which could
  // partially apply if one request failed while the other succeeded).
  // The server determines the adjacent question and swaps both
  // sort_order values in one atomic UPDATE — see that route's own
  // comment. Still scoped to the SAME scope group only, enforced
  // server-side now rather than by the client only ever calling this
  // with same-scope-group neighbors.
  async function move(questionId: string, direction: 'up' | 'down') {
    setActionError(null);
    setBusyId(questionId);
    try {
      const res = await fetch(`/api/events/${eventId}/questions/${questionId}/reorder`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? 'Failed to reorder.');
        return;
      }
      reload();
    } finally {
      setBusyId(null);
    }
  }

  const orderQuestions = (questions ?? []).filter(q => q.scope === 'ORDER');
  const attendeeQuestions = (questions ?? []).filter(q => q.scope === 'ATTENDEE');

  return (
    <Panel style={{ marginTop: 20 }}>
      <SectionHeader
        title="Registration Questions"
        sub="Collect dietary, accessibility, or other information from attendees at checkout."
        action={canManage && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!showCreate && (
              // Deliberately always passed value="" — this is an action
              // menu ("pick a template to pre-fill the create form"),
              // not a persistent filter, matching the native select's
              // own prior behavior of resetting to its placeholder the
              // instant a template is chosen (that reset used to be an
              // explicit `e.target.value = ''`; here it's implicit,
              // since this component's displayed value is always
              // whatever the parent passes, and the parent never stores
              // a "currently selected template").
              <FilterDropdown
                ariaLabel="Add a common question"
                value=""
                onChange={v => {
                  const tpl = COMMON_QUESTIONS.find(c => c.label === v);
                  if (tpl) { setCreateTemplate(tpl); setShowCreate(true); }
                }}
                options={[
                  { value: '', label: '+ Add common question…' },
                  ...COMMON_QUESTIONS.map((c): DropdownOption => ({ value: c.label, label: c.label })),
                ]}
              />
            )}
            <button onClick={() => { setCreateTemplate(null); setShowCreate(v => !v); }} style={secondaryBtnStyle}>
              {showCreate ? 'Cancel' : '+ Add Question'}
            </button>
          </div>
        )}
      />

      {loadError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 10 }}>{loadError}</div>}
      {actionError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 10 }}>{actionError}</div>}

      {showCreate && (
        <div style={{ marginBottom: 10 }}>
          <QuestionForm
            initial={createTemplate ?? undefined}
            onCancel={() => { setShowCreate(false); setCreateTemplate(null); }}
            onSubmit={async (values) => {
              const res = await fetch(`/api/events/${eventId}/questions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
              });
              if (res.ok) { setShowCreate(false); setCreateTemplate(null); reload(); }
              return res;
            }}
          />
        </div>
      )}

      {questions === null && !loadError && <div style={{ fontSize: 13, color: TEXT_MUTED }}>Loading…</div>}
      {questions !== null && questions.length === 0 && !showCreate && (
        <EmptyState title="No registration questions yet" body="Add a question to collect dietary, accessibility, or other information at registration." />
      )}

      {(['ORDER', 'ATTENDEE'] as const).map(scope => {
        const list = scope === 'ORDER' ? orderQuestions : attendeeQuestions;
        if (list.length === 0) return null;
        return (
          <div key={scope} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT_MUTED, marginBottom: 8 }}>
              {scope === 'ORDER' ? 'Asked once per booking' : 'Asked once per attendee'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((q, i) => editingId === q.id ? (
                <QuestionForm
                  key={q.id}
                  initial={q}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (values) => {
                    const res = await fetch(`/api/events/${eventId}/questions/${q.id}`, {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
                    });
                    if (res.ok) { setEditingId(null); reload(); }
                    return res;
                  }}
                />
              ) : (
                <div key={q.id} className="bb-evt-row" style={rowCardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: TEXT_PRIMARY }}>{q.label}</span>
                        {q.required && <StatusBadge label="Required" tone="warning" />}
                        {!q.active && <StatusBadge label="Inactive" tone="neutral" />}
                      </div>
                      <div style={{ marginTop: 5, fontSize: 12, color: TEXT_SECONDARY }}>
                        {FIELD_TYPE_LABELS[q.field_type]}
                        {q.options && q.options.length > 0 ? ` · ${q.options.join(', ')}` : ''}
                        {q.help_text ? ` · ${q.help_text}` : ''}
                      </div>
                    </div>
                    {canManage && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button" onClick={() => move(q.id, 'up')} disabled={i === 0 || busyId === q.id}
                          style={{ ...secondaryBtnStyle, opacity: i === 0 ? 0.4 : 1 }} aria-label={`Move ${q.label} up`}
                        >↑</button>
                        <button
                          type="button" onClick={() => move(q.id, 'down')} disabled={i === list.length - 1 || busyId === q.id}
                          style={{ ...secondaryBtnStyle, opacity: i === list.length - 1 ? 0.4 : 1 }} aria-label={`Move ${q.label} down`}
                        >↓</button>
                        <button onClick={() => setEditingId(q.id)} style={secondaryBtnStyle}>Edit</button>
                        {q.active ? (
                          <DangerButton ariaLabel={`Deactivate ${q.label}`} onClick={() => toggleActive(q)} disabled={busyId === q.id}>
                            {busyId === q.id ? 'Saving…' : 'Deactivate'}
                          </DangerButton>
                        ) : (
                          <button onClick={() => toggleActive(q)} disabled={busyId === q.id} style={secondaryBtnStyle}>
                            {busyId === q.id ? 'Saving…' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

type QuestionFormValues = {
  label: string; help_text: string | null; field_type: FieldType; required: boolean;
  scope: Scope; options: string[] | null; sort_order: number;
};

function QuestionForm({ initial, onSubmit, onCancel }: {
  initial?: Partial<QuestionRow>;
  onSubmit: (values: QuestionFormValues) => Promise<Response>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [helpText, setHelpText] = useState(initial?.help_text ?? '');
  const [fieldType, setFieldType] = useState<FieldType>(initial?.field_type ?? 'SHORT_TEXT');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [scope, setScope] = useState<Scope>(initial?.scope ?? 'ATTENDEE');
  const [options, setOptions] = useState<string[]>(initial?.options && initial.options.length > 0 ? initial.options : ['']);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isSelect = fieldType === 'SINGLE_SELECT' || fieldType === 'MULTI_SELECT';
  // Phase 4B pre-commit remediation §3 — distinguishes editing an
  // EXISTING question (initial.id is a real row id) from creating a new
  // one (initial may still be set, pre-filled from an "Add common
  // question" template, but has no id) — the historical-answer note
  // below is only meaningful once a question could already have
  // responses recorded against it.
  const isEditingExisting = Boolean(initial?.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const cleanedOptions = options.map(o => o.trim()).filter(Boolean);
      const res = await onSubmit({
        label, help_text: helpText.trim() || null, field_type: fieldType, required, scope,
        options: isSelect ? cleanedOptions : null, sort_order: Number(sortOrder),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed to save (${res.status}).`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...rowCardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={fieldStyle}>Question<input required className="bb-evt-input" value={label} onChange={e => setLabel(e.target.value)} style={inputStyle} /></label>
      <label style={fieldStyle}>Help text (optional)<input className="bb-evt-input" value={helpText ?? ''} onChange={e => setHelpText(e.target.value)} style={inputStyle} /></label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={fieldStyle}>Answer type
          <FilterDropdown
            ariaLabel="Answer type"
            value={fieldType}
            onChange={v => setFieldType(v as FieldType)}
            options={FIELD_TYPES.map((t): DropdownOption => ({ value: t, label: FIELD_TYPE_LABELS[t] }))}
            style={{ width: '100%' }}
            triggerStyle={{ width: '100%' }}
          />
        </label>
        <label style={fieldStyle}>Asked
          <FilterDropdown
            ariaLabel="Asked"
            value={scope}
            onChange={v => setScope(v as Scope)}
            options={SCOPES.map((s): DropdownOption => ({ value: s, label: SCOPE_LABELS[s] }))}
            style={{ width: '100%' }}
            triggerStyle={{ width: '100%' }}
          />
        </label>
      </div>

      {isSelect && (
        <div>
          <div style={fieldStyle}>Options</div>
          {isEditingExisting && (
            <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 4, marginBottom: 2, lineHeight: 1.5 }}>
              Changing or removing an option here only affects future registrations — anyone who already answered this
              question keeps their original recorded answer exactly as submitted, even if it referenced an option you
              later change or remove.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {options.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input
                  className="bb-evt-input" value={opt} style={{ ...inputStyle, flex: 1 }}
                  onChange={e => setOptions(prev => prev.map((o, idx) => idx === i ? e.target.value : o))}
                />
                <button
                  type="button" style={secondaryBtnStyle} disabled={options.length <= 1}
                  onClick={() => setOptions(prev => prev.filter((_, idx) => idx !== i))}
                >Remove</button>
              </div>
            ))}
          </div>
          <button type="button" style={{ ...secondaryBtnStyle, marginTop: 6 }} onClick={() => setOptions(prev => [...prev, ''])}>+ Add option</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
        <label style={fieldStyle}>Sort order<input type="number" className="bb-evt-input" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} style={inputStyle} /></label>
        <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required
        </label>
      </div>

      {error && <div role="alert" style={{ color: '#FCA5A5', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}
