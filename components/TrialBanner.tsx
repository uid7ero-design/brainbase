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

  // Phase D2: tokens only. Expired is a danger state; an active trial is
  // product state, so it uses the restrained accent; the last three days
  // are a warning, written in the text as well as coloured.
  if (daysLeft <= 0) {
    return (
      <div role="status" style={{
        background: 'var(--status-danger-muted)', borderBottom: '1px solid var(--status-danger-border)',
        padding: '8px 24px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        fontFamily: "var(--font-inter), -apple-system, sans-serif",
      }}>
        <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 700, letterSpacing: '0.06em' }}>⚠ TRIAL EXPIRED</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Your 14-day trial has ended. Contact us to continue using HLNA.</span>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
      padding: '7px 24px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      fontFamily: "var(--font-inter), -apple-system, sans-serif",
    }}>
      <span style={{
        fontSize: 10, padding: '2px 7px', borderRadius: 'var(--radius-sm)',
        background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)',
        color: 'var(--brand-brainbase-accent)', fontWeight: 700, letterSpacing: '0.08em',
      }}>TRIAL</span>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Trial active —{' '}
        <span style={{ color: daysLeft <= 3 ? 'var(--status-warning)' : 'var(--text-primary)', fontWeight: 600 }}>
          {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
        </span>
        . Explore your data with HLNA.
      </span>
    </div>
  );
}
