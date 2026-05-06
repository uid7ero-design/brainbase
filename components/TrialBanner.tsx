import { getSession } from '@/lib/session';
import sql from '@/lib/db';

export async function TrialBanner() {
  const session = await getSession();
  if (!session?.organisationId) return null;

  const [org] = await sql`
    SELECT plan, trial_ends_at FROM organisations WHERE id = ${session.organisationId}::uuid
  `.catch(() => []);

  if (!org || org.plan !== 'trial' || !org.trial_ends_at) return null;

  const daysLeft = Math.max(0, Math.ceil(
    (new Date(org.trial_ends_at as string).getTime() - Date.now()) / 86_400_000,
  ));

  if (daysLeft <= 0) {
    return (
      <div style={{
        background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.20)',
        padding: '8px 36px', display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: "var(--font-inter), -apple-system, sans-serif",
      }}>
        <span style={{ fontSize: 10, color: '#F87171', fontWeight: 700, letterSpacing: '0.08em' }}>⚠ TRIAL EXPIRED</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Your 14-day trial has ended. Contact us to continue using HLNA.</span>
      </div>
    );
  }

  return (
    <div style={{
      background: 'rgba(124,58,237,0.06)', borderBottom: '1px solid rgba(124,58,237,0.15)',
      padding: '7px 36px', display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: "var(--font-inter), -apple-system, sans-serif",
    }}>
      <span style={{
        fontSize: 9, padding: '2px 7px', borderRadius: 4,
        background: 'rgba(124,58,237,0.20)', border: '1px solid rgba(124,58,237,0.35)',
        color: '#A78BFA', fontWeight: 700, letterSpacing: '0.10em',
      }}>TRIAL</span>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)' }}>
        Trial active —{' '}
        <span style={{ color: daysLeft <= 3 ? '#FBBF24' : 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
          {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
        </span>
        . Explore your data with HLNA.
      </span>
    </div>
  );
}
