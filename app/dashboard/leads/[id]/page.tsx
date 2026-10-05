import { requireRole } from '@/lib/org';
import { redirect, notFound } from 'next/navigation';
import sql from '@/lib/db';
import Link from 'next/link';
import { Badge, PageHeader, Panel, buttonProps } from '@/components/ui/app';
import DeleteLeadButton from './DeleteLeadButton';
import LeadStatusPicker from './LeadStatusPicker';
import ConvertToSquadButton from './ConvertToSquadButton';
import LeadMessaging from './LeadMessaging';
import { leadStatusLabel, leadStatusState } from '../leadStatus';
import styles from '../Leads.module.css';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className={styles.detailRow}>
      <dt className={styles.detailLabel}>{label}</dt>
      <dd className={styles.detailValue}>{value || '—'}</dd>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch { redirect('/login'); }

  const { id } = await params;

  const rows = await sql`
    SELECT id, name, email, phone, session_type, message, status, notes, created_at
    FROM tennis_leads
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;

  if (rows.length === 0) notFound();
  const lead = rows[0];

  // Same identity link the conversion endpoint uses (org + case-insensitive
  // email) — only to derive whether the "Add to Squad" button should render
  // as already-converted; the endpoint itself re-derives this server-side.
  const squadRows = await sql`
    SELECT status FROM contacts
    WHERE organisation_id = ${session.organisationId}
      AND LOWER(email) = LOWER(${lead.email as string})
    LIMIT 1
  `;
  const inSquad = squadRows[0]?.status === 'active';
  const canOfferSquad = inSquad || ['new', 'contacted', 'in_progress'].includes(lead.status as string);

  const receivedAt = new Date(lead.created_at as string);

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/leads" {...buttonProps('secondary', 'sm')}>
            ← Back to Leads
          </Link>
        }
        title={lead.name as string}
        description={
          <>Received {receivedAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} at {receivedAt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</>
        }
      />

      <div className={styles.stack}>
        <LeadStatusPicker leadId={lead.id as string} currentStatus={lead.status as string} currentNotes={lead.notes as string | null} />

        <Panel
          title="Lead Details"
          actions={
            <Badge state={leadStatusState(lead.status as string)} className={styles.statusBadge}>
              {leadStatusLabel(lead.status as string)}
            </Badge>
          }
        >
          <dl className={styles.detailList}>
            <Field label="Full Name" value={lead.name as string} />
            <Field label="Email" value={lead.email as string} />
            <Field label="Phone" value={lead.phone as string} />
            <Field label="Session Type" value={lead.session_type as string} />
            <Field label="Message" value={lead.message as string} />
          </dl>
        </Panel>

        <LeadMessaging leadId={lead.id as string} leadName={lead.name as string} leadEmail={lead.email as string} />
      </div>

      <div className={styles.actionsRow}>
        <div className={styles.actionGroup}>
          <a
            href={`mailto:${lead.email as string}`}
            {...buttonProps('primary')}
          >
            Reply by Email
          </a>
          {lead.phone && (
            <a
              href={`tel:${lead.phone as string}`}
              {...buttonProps('secondary')}
            >
              Call {lead.phone as string}
            </a>
          )}
        </div>
        <div className={styles.actionGroup}>
          {canOfferSquad && <ConvertToSquadButton leadId={lead.id as string} initialInSquad={inSquad} />}
          <DeleteLeadButton leadId={lead.id as string} />
        </div>
      </div>
    </div>
  );
}
