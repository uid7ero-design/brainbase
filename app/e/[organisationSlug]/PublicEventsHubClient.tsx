'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Calendar, MapPin, Ticket } from 'lucide-react';
import type { PublicHubEvent } from '@/lib/events/publicEventsHub';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

// Same hardcoded, always-dark palette convention as
// PublicEventClient.tsx and app/t/[token]/page.tsx — a public,
// unauthenticated destination page that must render identically
// regardless of any staff member's light/dark toggle elsewhere in the
// app. Deliberately not importing the constants from
// PublicEventClient.tsx: that file is a single-event booking page,
// not a shared design-tokens module, and duplicating a handful of
// hex/rgba literals here is simpler than introducing a new shared
// import surface for them.
const BG = '#07080B';
const BORDER = 'rgba(255,255,255,.08)';
const BORDER_SOFT = 'rgba(255,255,255,.06)';
const VIOLET_SOFT = '#A78BFA';
const TEXT_PRIMARY = '#F5F7FA';
const TEXT_SECONDARY = 'rgba(226,232,240,.66)';
const TEXT_MUTED = 'rgba(226,232,240,.42)';
const GREEN = '#4ADE80';

function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(iso));
}
function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso));
}
function formatFromPrice(cents: number | null): string | null {
  if (cents === null) return null;
  return cents === 0 ? 'Free' : `From $${(cents / 100).toFixed(2)}`;
}

export default function PublicEventsHubClient({
  organisationSlug, organisationName, events,
}: {
  organisationSlug: string; organisationName: string; events: PublicHubEvent[];
}) {
  return (
    <div style={{ minHeight: '100vh', background: BG, color: TEXT_PRIMARY, fontFamily: FONT }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(7,8,11,.86)', backdropFilter: 'blur(16px)', borderBottom: `1px solid ${BORDER_SOFT}` }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '13px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Image src="/Brand/brainbase-logo-dark.svg" alt="BRΛINBΛSE" width={132} height={30} priority style={{ display: 'block', width: 120, height: 'auto' }} />
          <span style={{ fontSize: 11, color: TEXT_MUTED, letterSpacing: '.03em', fontWeight: 500 }}>Powered by BrainBase</span>
        </div>
      </header>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 20px 88px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: VIOLET_SOFT, marginBottom: 10 }}>
          <Ticket size={13} /> Events
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 32px' }}>{organisationName}</h1>

        {events.length === 0 ? (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 16, background: 'rgba(255,255,255,.02)', padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, color: TEXT_SECONDARY, margin: 0 }}>No upcoming events</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
            {events.map(event => (
              <EventCard key={event.id} organisationSlug={organisationSlug} event={event} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EventCard({ organisationSlug, event }: { organisationSlug: string; event: PublicHubEvent }) {
  const priceLabel = formatFromPrice(event.from_price_cents);
  return (
    <Link
      href={`/e/${organisationSlug}/${event.slug}`}
      style={{
        display: 'flex', flexDirection: 'column', border: `1px solid ${BORDER}`, borderRadius: 14,
        background: 'rgba(255,255,255,.02)', overflow: 'hidden', textDecoration: 'none', color: 'inherit',
        transition: 'border-color .15s ease',
      }}
    >
      <div style={{ aspectRatio: '16 / 9', background: 'rgba(255,255,255,.03)', position: 'relative', overflow: 'hidden' }}>
        {event.artwork_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.artwork_url} alt={event.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ticket size={28} color={TEXT_MUTED} />
          </div>
        )}
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY }}>{event.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: TEXT_SECONDARY }}>
          <Calendar size={13} color={VIOLET_SOFT} />
          {formatDate(event.starts_at, event.timezone)} · {formatTime(event.starts_at, event.timezone)}
        </div>
        {event.venue && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: TEXT_SECONDARY }}>
            <MapPin size={13} color={VIOLET_SOFT} />
            {event.venue}
          </div>
        )}
        {priceLabel && (
          <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 13, fontWeight: 700, color: priceLabel === 'Free' ? GREEN : VIOLET_SOFT }}>
            {priceLabel}
          </div>
        )}
      </div>
    </Link>
  );
}
