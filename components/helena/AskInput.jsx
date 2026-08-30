'use client';

import { useState } from "react";

const FONT = "var(--font-inter),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

// Shared with the equivalent private AskInput in components/BrainBase.jsx
// (that copy is left untouched this phase — see lib/helena/visualState.js
// for why). Identical markup/behaviour, just importable.
export function AskInput({ onSend }) {
  const [val, setVal] = useState('');
  return (
    <form
      onSubmit={e => { e.preventDefault(); const q = val.trim(); if (q) { onSend(q); setVal(''); } }}
      style={{ width: '100%', display: 'flex', gap: 6, padding: '0 2px' }}
    >
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="Ask HLNA…"
        style={{
          flex: 1, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)',
          borderRadius: 8, padding: '9px 13px', fontSize: 12, color: '#F4F4F5',
          fontFamily: FONT, outline: 'none', minWidth: 0,
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,.40)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)'; }}
      />
      <button
        type="submit"
        style={{
          padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          background: 'rgba(124,58,237,.20)', border: '1px solid rgba(124,58,237,.40)',
          color: '#C4B5FD', cursor: 'pointer', fontFamily: FONT, flexShrink: 0,
          transition: 'all .18s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,.32)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,.20)'; }}
      >
        →
      </button>
    </form>
  );
}
