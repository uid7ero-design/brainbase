import type { MigrationReadExecutor } from './migrationSnapshot';
const TENNIS_ORG='8ecd003b-583f-4616-a830-8dbf8aa51d2c';
export interface PublicBookingInput {session_instance_id:string;name:string;email:string;phone?:string;idempotencyKey:string}
export interface PublicBookingReceipt {success:true;booking:{id:string;session_name:string;date:string;start_time:string}}
/** Anonymous access is fixed to the configured Tennis organisation. It never
 * constructs a staff identity or returns roster/contact information. */
export class TennisPublicBooking {
  constructor(private readonly sql:MigrationReadExecutor,private readonly organisationId:string) {}
  async phase():Promise<'legacy'|'frozen'|'scheduling'> {
    if(this.organisationId!==TENNIS_ORG) return 'legacy';
    const installed=await this.sql.query<{ready:boolean}>("SELECT to_regclass('public.scheduling_tennis_cutover') IS NOT NULL ready",[]);
    if(!installed[0]?.ready)return 'legacy';
    const rows=await this.sql.query<{phase:'legacy'|'frozen'|'scheduling'}>('SELECT phase FROM scheduling_tennis_cutover WHERE organisation_id=$1',[this.organisationId]);
    if(!rows[0])return 'legacy';
    if(!['legacy','frozen','scheduling'].includes(rows[0].phase))throw Error('Invalid authority');
    return rows[0].phase;
  }
  async sessions() {
    if(await this.phase()!=='scheduling')throw Object.assign(Error('Booking unavailable'),{code:'STOFF'});
    return this.sql.query(`SELECT o.id,o.offering_id session_id,to_char(o.local_date,'YYYY-MM-DD') date,
      to_char(o.local_start_time,'HH24:MI') start_time,(extract(epoch FROM o.ends_at-o.starts_at)/60)::int duration_minutes,
      o.capacity max_capacity,o.status,f.name session_name,f.type_key session_type,NULL::text resource_id,
      (SELECT count(*)::int FROM scheduling_reservations r WHERE r.organisation_id=o.organisation_id AND r.occurrence_id=o.id AND r.status<>'cancelled') enrolled_count
      FROM scheduling_occurrences o JOIN scheduling_offerings f ON f.organisation_id=o.organisation_id AND f.id=o.offering_id
      JOIN scheduling_schedules s ON s.organisation_id=f.organisation_id AND s.id=f.schedule_id
      JOIN scheduling_tennis_cutover c ON c.organisation_id=s.organisation_id AND c.phase='scheduling'
      JOIN scheduling_tennis_import_receipts r ON r.organisation_id=c.organisation_id AND r.source_hash=c.captured_hash
      JOIN organisations n ON n.id=c.organisation_id AND n.status='ACTIVE' AND n.slug='ld-tennis'
      JOIN organisation_modules om ON om.organisation_id=n.id AND om.module_key='scheduling' AND om.enabled=true
      JOIN modules m ON m.key=om.module_key AND m.active=true
      WHERE o.organisation_id=$1 AND s.id='tennis-coaching' AND s.archived_at IS NULL AND f.archived_at IS NULL
        AND o.status='scheduled' AND o.starts_at>now() AND o.local_date<=(now() AT TIME ZONE s.timezone)::date+28
      ORDER BY o.local_date,o.local_start_time,o.id LIMIT 500`,[this.organisationId]);
  }
  async saved(key:string):Promise<PublicBookingReceipt|null> {
    if(this.organisationId!==TENNIS_ORG || !/^[A-Za-z0-9_-]{16,80}$/.test(key))throw Error('Invalid public booking key');
    if(await this.phase()==='legacy')return null;
    return (await this.sql.query<{result:PublicBookingReceipt}>(`SELECT result FROM scheduling_coaching_commands
      WHERE organisation_id=$1 AND command_key=$2 AND request->>'kind'='public-book'`,[this.organisationId,key]))[0]?.result ?? null;
  }
  async book(input:PublicBookingInput):Promise<PublicBookingReceipt> {
    if(this.organisationId!==TENNIS_ORG)throw Object.assign(Error('Booking unavailable'),{code:'STOFF'});
    // The stored request must match to recover; possession of a reused key alone
    // never converts a different request into success.
    const body={kind:'public-book',occurrenceId:input.session_instance_id,name:input.name.trim(),email:input.email.trim().toLowerCase(),phone:input.phone ?? null};
    try {
      const rows=await this.sql.query<{result:PublicBookingReceipt}>('SELECT scheduling_tennis_public_book($1,$2,$3,$4,$5,$6) result',
        [this.organisationId,input.session_instance_id,input.name.trim(),input.email.trim(),input.phone ?? null,input.idempotencyKey]);
      if(!rows[0]?.result)throw Error('Booking result unavailable');return rows[0].result;
    } catch(error) {
      const rows=await this.sql.query<{result:PublicBookingReceipt}>(`SELECT result FROM scheduling_coaching_commands WHERE organisation_id=$1 AND command_key=$2 AND request=$3::jsonb`,
        [this.organisationId,input.idempotencyKey,JSON.stringify(body)]);
      if(rows[0])return rows[0].result;throw error;
    }
  }
}
