'use client';

// Next 16 error boundary contract: { error, unstable_retry }.
// The underlying error message is not shown — it may carry server detail.
export default function AssuranceError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <div role="alert" style={{ maxWidth: 560, padding: '40px 0' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Something went wrong loading Assurance</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.6 }}>
        Nothing has been changed. Try again, and if this keeps happening, share the reference below with your BrainBase admin.
      </p>
      {error.digest && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono), monospace', margin: '0 0 16px' }}>Ref: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={() => unstable_retry()}
        style={{ padding: '8px 14px', background: 'var(--purple-600)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        Try again
      </button>
    </div>
  );
}
