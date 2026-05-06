"use client";

import CommandDemo from "@/components/CommandDemo";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

export default function AppPage() {
  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 480, padding: '0 32px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', color: '#F1F5F9', margin: '0 0 24px' }}>
          Ask HLNΛ
        </h1>
        <CommandDemo placeholder="Type a query..." />
      </div>
    </main>
  );
}
