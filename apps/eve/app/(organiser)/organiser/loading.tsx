export default function OrganiserLoading() {
  return (
    <div className="min-h-screen bg-eve-canvas px-4 py-8 sm:px-8">
      <p role="status" className="text-sm font-medium text-eve-ink-soft">Loading Eve…</p>
      <div aria-hidden="true" className="mt-6 space-y-4">
        <div className="h-8 w-48 rounded-lg bg-eve-surface-alt" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-lg border border-eve-line bg-eve-surface" />)}
        </div>
        <div className="h-64 rounded-lg border border-eve-line bg-eve-surface" />
      </div>
    </div>
  );
}
