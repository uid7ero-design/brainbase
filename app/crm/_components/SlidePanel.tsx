'use client';

export default function SlidePanel({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.6)' }} />
      <div style={{ width: 440, background: '#0e1014', borderLeft: '1px solid #1a1d24', display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid #1a1d24', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#f9fafb' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
