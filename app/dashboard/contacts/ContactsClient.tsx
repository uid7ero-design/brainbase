"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  last_contacted_at: string | null;
  created_at: string;
};

type Filter = "all" | "active" | "attention";

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  lead:      { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.22)',   label: 'Lead' },
  contacted: { bg: 'rgba(251,191,36,.10)',  color: '#fbbf24', border: 'rgba(251,191,36,.22)',  label: 'Contacted' },
  active:    { bg: 'rgba(59,130,246,.10)',  color: '#60a5fa', border: 'rgba(59,130,246,.22)',  label: 'Active' },
  inactive:  { bg: 'rgba(113,113,122,.10)', color: '#71717a', border: 'rgba(113,113,122,.22)', label: 'Inactive' },
};

// Deterministic hue from name so each person gets a consistent avatar colour
const AVATAR_HUES = [210, 160, 280, 30, 340, 50, 190, 120];
function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % AVATAR_HUES.length;
  return AVATAR_HUES[h];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function needsAttention(c: Contact): boolean {
  if (c.status === 'inactive') return false;
  if (!c.last_contacted_at) return true;
  const days = (Date.now() - new Date(c.last_contacted_at).getTime()) / 86400000;
  return days > 7;
}

function lastContactedLabel(ts: string | null): string {
  if (!ts) return 'Never';
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function ContactTile({ contact }: { contact: Contact }) {
  const [status, setStatus] = useState(contact.status);
  const [saving, setSaving] = useState(false);
  const attention = needsAttention({ ...contact, status });
  const badge = STATUS_STYLES[status] ?? STATUS_STYLES.lead;
  const hue = avatarHue(contact.name);

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setStatus(val);
    setSaving(true);
    await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: val }),
    });
    setSaving(false);
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: `1px solid ${attention ? 'rgba(251,191,36,.25)' : 'rgba(255,255,255,.07)'}`,
      borderRadius: 16,
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      transition: 'border-color .15s, background .15s',
      fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>

      {/* Avatar + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Avatar */}
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: `hsl(${hue},55%,22%)`,
          border: `1.5px solid hsl(${hue},55%,35%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: `hsl(${hue},80%,72%)`,
          letterSpacing: '.02em',
        }}>
          {initials(contact.name)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Link
            href={`/dashboard/contacts/${contact.id}`}
            style={{ fontSize: 14, fontWeight: 600, color: '#F5F7FA', textDecoration: 'none', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {contact.name}
          </Link>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', marginTop: 2 }}>
            Last: {lastContactedLabel(contact.last_contacted_at)}
          </div>
        </div>

        {attention && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            background: 'rgba(251,191,36,.12)', color: '#fbbf24',
            border: '1px solid rgba(251,191,36,.28)', letterSpacing: '.06em',
            textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            Attn
          </span>
        )}
      </div>

      {/* Contact info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <a href={`mailto:${contact.email}`} style={{ fontSize: 12, color: 'rgba(255,255,255,.40)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {contact.email}
        </a>
        {contact.phone && (
          <a href={`tel:${contact.phone}`} style={{ fontSize: 12, color: 'rgba(255,255,255,.30)', textDecoration: 'none' }}>
            {contact.phone}
          </a>
        )}
      </div>

      {/* Status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        <select
          value={status}
          onChange={handleStatusChange}
          disabled={saving}
          style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
            background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
            letterSpacing: '.04em', textTransform: 'capitalize', cursor: 'pointer',
            outline: 'none', flex: 1,
          }}
        >
          <option value="lead">Lead</option>
          <option value="contacted">Contacted</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <div style={{ display: 'flex', gap: 5 }}>
          {contact.phone && (
            <a href={`tel:${contact.phone}`} style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 7, background: 'rgba(34,197,94,.10)', color: '#4ade80', border: '1px solid rgba(34,197,94,.18)', textDecoration: 'none' }}>
              Call
            </a>
          )}
          <a href={`mailto:${contact.email}`} style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 7, background: 'rgba(59,130,246,.10)', color: '#60a5fa', border: '1px solid rgba(59,130,246,.18)', textDecoration: 'none' }}>
            Email
          </a>
          <Link href={`/dashboard/contacts/${contact.id}`} style={{ fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 7, background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.55)', border: '1px solid rgba(255,255,255,.10)', textDecoration: 'none' }}>
            View
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ContactsClient({ contacts }: { contacts: Contact[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const sorted = useMemo(() => {
    return [...contacts].sort((a, b) => {
      const aNeed = needsAttention(a) ? 0 : 1;
      const bNeed = needsAttention(b) ? 0 : 1;
      return aNeed - bNeed;
    });
  }, [contacts]);

  const filtered = useMemo(() => {
    if (filter === "active") return sorted.filter(c => c.status === "active");
    if (filter === "attention") return sorted.filter(needsAttention);
    return sorted;
  }, [sorted, filter]);

  const attentionCount = contacts.filter(needsAttention).length;

  function tabStyle(t: Filter) {
    const active = filter === t;
    return {
      padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      border: active ? '1px solid rgba(255,255,255,.12)' : '1px solid transparent',
      background: active ? 'rgba(255,255,255,.08)' : 'transparent',
      color: active ? '#F5F7FA' : 'rgba(255,255,255,.35)',
      transition: 'all .15s',
    } as React.CSSProperties;
  }

  return (
    <div style={{ fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        <button onClick={() => setFilter("all")} style={tabStyle("all")}>All ({contacts.length})</button>
        <button onClick={() => setFilter("active")} style={tabStyle("active")}>Active</button>
        <button onClick={() => setFilter("attention")} style={tabStyle("attention")}>
          Needs Attention{attentionCount > 0 && (
            <span style={{ marginLeft: 6, background: 'rgba(251,191,36,.18)', color: '#fbbf24', padding: '1px 6px', borderRadius: 10, fontSize: 10 }}>
              {attentionCount}
            </span>
          )}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.025)', padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>
          {filter === "attention" ? "No contacts need attention right now." :
           filter === "active" ? "No active contacts yet." :
           "No contacts yet. They'll appear here when someone submits the form."}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}>
          {filtered.map(c => <ContactTile key={c.id} contact={c} />)}
        </div>
      )}
    </div>
  );
}
