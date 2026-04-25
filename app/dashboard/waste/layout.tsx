import NavTabs from "./NavTabs";

export default function WasteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#08090C', minHeight: '100vh', fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <div style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)' }} className="text-white px-8 pt-7 pb-0">
        <div className="max-w-7xl mx-auto">
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-1">Executive Operations Report</p>
          <h1 className="text-3xl font-bold tracking-tight">Waste &amp; Recycling Intelligence</h1>
          <NavTabs />
        </div>
      </div>
      {children}
    </div>
  );
}
