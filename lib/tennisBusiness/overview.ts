import 'server-only';
import sql from '@/lib/db';
import { coachingAuthority } from './coachingAuthority';
import { businessPeriod, exactCents, type BusinessModule, type BusinessOverview, type Section } from './model';

async function read<T>(enabled: boolean, run: () => Promise<T>): Promise<Section<T>> {
  if (!enabled) return { state: 'not_enabled' };
  try { return { state: 'ready', value: await run() }; } catch { return { state: 'unavailable' }; }
}
function count(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid count');
  return value;
}
function currency(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new Error('Invalid currency');
  return value;
}
/** Read-only projection. Every source remains authoritative; no synthetic profit or cross-currency total. */
export async function readTennisBusiness(organisationId: string, modules: BusinessModule[], month: string): Promise<BusinessOverview> {
  const { from, to } = businessPeriod(month);
  const [coaching, crm, income, costs, receiptSpending] = await Promise.all([
    read(modules.includes('scheduling'), async () => {
      const authority=await coachingAuthority(organisationId);
      if(authority==='frozen')throw Error('Coaching handover paused');
      if(authority==='scheduling') {
        const [row]=await sql`SELECT to_char(now() AT TIME ZONE 'Australia/Adelaide','YYYY-MM-DD') AS today,
          (SELECT count(*)::int FROM scheduling_occurrences o JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id
            WHERE o.organisation_id=${organisationId} AND f.schedule_id='tennis-coaching' AND o.local_date=(now() AT TIME ZONE o.timezone)::date AND o.status='scheduled') sessions,
          (SELECT count(*)::int FROM contacts WHERE organisation_id=${organisationId} AND status='active') players`;
        if(typeof row?.today!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.today))throw Error('Invalid date');
        return {today:row.today,sessions:count(row.sessions),players:count(row.players)};
      }
      const [row] = await sql`SELECT to_char(now() AT TIME ZONE 'Australia/Adelaide','YYYY-MM-DD') AS today,
        (SELECT count(*)::int FROM session_instances i JOIN sessions s ON s.id=i.session_id
         WHERE s.organisation_id=${organisationId} AND i.date=(now() AT TIME ZONE 'Australia/Adelaide')::date AND i.status='scheduled') AS sessions,
        (SELECT count(*)::int FROM contacts WHERE organisation_id=${organisationId} AND status='active') AS players`;
      if (typeof row?.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.today)) throw new Error('Invalid date');
      return { today: row.today, sessions: count(row.sessions), players: count(row.players) };
    }),
    read(modules.includes('crm'), async () => {
      const [row] = await sql`SELECT
        (SELECT count(*)::int FROM crm_contacts WHERE organisation_id=${organisationId}) AS contacts,
        (SELECT count(*)::int FROM crm_deals WHERE organisation_id=${organisationId} AND stage NOT IN ('closed_won','closed_lost')) AS deals`;
      return { contacts: count(row?.contacts), openDeals: count(row?.deals) };
    }),
    read(modules.includes('invoicing'), async () => {
      const rows = await sql`WITH invoices AS (
        SELECT currency, COALESCE(sum(total_cents) FILTER (WHERE issue_date>=${from}::date AND issue_date<${to}::date),0) AS invoiced,
          COALESCE(sum(greatest(total_cents-COALESCE((SELECT sum(a.allocated_amount_cents) FROM commercial_payment_allocations a
            JOIN commercial_payments p ON p.id=a.payment_id AND p.organisation_id=a.organisation_id
            WHERE a.organisation_id=i.organisation_id AND a.invoice_id=i.id AND p.status='RECORDED'),0),0)),0) AS outstanding
        FROM commercial_invoices i WHERE organisation_id=${organisationId} AND status='ISSUED' GROUP BY currency
      ), payments AS (
        SELECT currency,sum(amount_cents) AS received FROM commercial_payments
        WHERE organisation_id=${organisationId} AND status='RECORDED'
          AND received_at>=(${from}::date::timestamp AT TIME ZONE 'Australia/Adelaide')
          AND received_at<(${to}::date::timestamp AT TIME ZONE 'Australia/Adelaide') GROUP BY currency
      ) SELECT COALESCE(i.currency,p.currency) AS currency, COALESCE(i.invoiced,0)::text AS invoiced_cents,
        COALESCE(p.received,0)::text AS received_cents,COALESCE(i.outstanding,0)::text AS outstanding_cents
        FROM invoices i FULL JOIN payments p ON p.currency=i.currency ORDER BY 1`;
      return rows.map(row => ({ currency: currency(row.currency), invoiced_cents: exactCents(row.invoiced_cents), received_cents: exactCents(row.received_cents), outstanding_cents: exactCents(row.outstanding_cents) }));
    }),
    read(modules.includes('purchasing'), async () => {
      const rows = await sql`WITH bills AS (
        SELECT currency,sum(total_cents) AS billed FROM commercial_supplier_bills WHERE organisation_id=${organisationId} AND status='POSTED'
          AND bill_date>=${from}::date AND bill_date<${to}::date GROUP BY currency
      ), payments AS (
        SELECT currency,sum(amount_cents) AS paid FROM commercial_supplier_payments WHERE organisation_id=${organisationId} AND status='RECORDED'
          AND paid_at>=(${from}::date::timestamp AT TIME ZONE 'Australia/Adelaide')
          AND paid_at<(${to}::date::timestamp AT TIME ZONE 'Australia/Adelaide') GROUP BY currency
      ) SELECT COALESCE(b.currency,p.currency) AS currency,COALESCE(b.billed,0)::text AS billed_cents,COALESCE(p.paid,0)::text AS paid_cents
        FROM bills b FULL JOIN payments p ON p.currency=b.currency ORDER BY 1`;
      return rows.map(row => ({ currency: currency(row.currency), billed_cents: exactCents(row.billed_cents), paid_cents: exactCents(row.paid_cents) }));
    }),
    read(modules.includes('purchasing'), async () => {
      const [row] = await sql`SELECT COALESCE(SUM(amount_cents), 0)::text AS total
        FROM tennis_receipt_expenses WHERE organisation_id=${organisationId}
          AND purchase_date >= ${from} AND purchase_date < ${to}`;
      return exactCents(row?.total);
    }),
  ]);
  return { month, timezone: 'Australia/Adelaide', modules, coaching, crm, income, costs, receiptSpending };
}
