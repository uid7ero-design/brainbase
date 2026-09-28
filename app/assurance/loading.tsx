export default function AssuranceLoading() {
  return (
    <div role="status" aria-live="polite" style={{ maxWidth: 1100 }}>
      <div style={{ height: 26, width: 220, borderRadius: 6, background: 'var(--bg-surface)', marginBottom: 20 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 78, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
        ))}
      </div>
      <div style={{ height: 260, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading…</span>
    </div>
  );
}
