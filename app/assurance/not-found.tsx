import Link from 'next/link';

// Deliberately does not distinguish "does not exist", "another
// organisation's record" and "restricted from you" — all three look the same.
export default function AssuranceNotFound() {
  return (
    <div style={{ maxWidth: 520, padding: '40px 0' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Record not found</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
        This Assurance record doesn&apos;t exist, or you don&apos;t have access to it. Restricted records are only visible to the
        people involved and organisation admins.
      </p>
      <Link href="/assurance" style={{ fontSize: 13, color: 'var(--brand-brainbase-accent)', textDecoration: 'none' }}>← Back to Assurance</Link>
    </div>
  );
}
