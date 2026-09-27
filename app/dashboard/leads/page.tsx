import { requireRole } from '@/lib/org';
import { redirect } from 'next/navigation';
import sql from '@/lib/db';
import Link from 'next/link';
import { Badge, PageHeader, StateMessage, TableContainer, tableStyles } from '@/components/ui/app';
import { leadStatusState } from './leadStatus';
import styles from './Leads.module.css';


function formatDateTime(ts: string) {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
  };
}

export default async function LeadsDashboard() {
  let session;
  try { session = await requireRole('viewer'); } catch { redirect('/login'); }

  const leads = await sql`
    SELECT id, name, email, phone, session_type, message, status, created_at
    FROM tennis_leads
    WHERE organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Tennis Leads"
        description={`${leads.length} total lead${leads.length !== 1 ? 's' : ''} from ldtennis.com.au`}
      />

      {leads.length === 0 ? (
        <StateMessage kind="empty" size="page" title={<>No leads yet. They&apos;ll appear here when someone submits the form at <span className={styles.inlineCode}>/tennis</span>.</>} />
      ) : (
        <TableContainer label="Tennis leads" minWidth={760}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Contact</th>
                <th scope="col">Session Type</th>
                <th scope="col">Message</th>
                <th scope="col">Status</th>
                <th scope="col">Received</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => {
                const { date, time } = formatDateTime(lead.created_at);
                return (
                  <tr key={lead.id}>
                    <td className={tableStyles.primary}>
                      <Link href={`/dashboard/leads/${lead.id}`} className={tableStyles.link}>{lead.name}</Link>
                    </td>
                    <td>
                      <a href={`mailto:${lead.email}`} className={tableStyles.link}>{lead.email}</a>
                      {lead.phone && <span className={styles.secondaryLine}>{lead.phone}</span>}
                    </td>
                    <td className={lead.session_type ? undefined : tableStyles.muted}>{lead.session_type || '—'}</td>
                    <td className={styles.message} title={lead.message || undefined}>{lead.message || '—'}</td>
                    <td>
                      <Badge state={leadStatusState(lead.status)} className={styles.statusBadge}>{lead.status}</Badge>
                    </td>
                    <td className={styles.received}>
                      <span style={{ display: 'block' }}>{date}</span>
                      <span className={styles.secondaryLine}>{time}</span>
                    </td>
                    <td className={tableStyles.actions}>
                      <Link href={`/dashboard/leads/${lead.id}`} className={tableStyles.link} aria-label={`View ${lead.name}`}>View →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableContainer>
      )}
    </div>
  );
}
