'use client';
import { useRouter } from 'next/navigation';

export default function CrmMoved({ section }: { section: string }) {
  const router = useRouter();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '55vh', gap: 12, textAlign: 'center', padding: 32 }}>
      <div style={{ fontSize: 28, marginBottom: 4, color: '#8B5CF6' }}>→</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#f9fafb', marginBottom: 2 }}>
        CRM is now managed in Founder OS
      </div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8, maxWidth: 360 }}>
        {section} and all business management has moved to the unified Founder OS dashboard.
      </div>
      <button
        onClick={() => router.push('/admin/founder')}
        style={{ padding: '10px 24px', background: '#8B5CF6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        Open Founder OS
      </button>
      <div style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>
        This page is kept for reference only.
      </div>
    </div>
  );
}
