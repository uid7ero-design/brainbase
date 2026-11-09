import 'server-only';
import { createSchedulingExecutor } from './runtime';

import { authorizeSchedulingRequest } from './access';

export async function squadSession() {
  const [manage, book] = await Promise.all([
    authorizeSchedulingRequest('scheduling.manage'),
    authorizeSchedulingRequest('scheduling.reserve', { feature: 'staff_booking' }),
  ]);
  if (
    !manage.ok ||
    !book.ok ||
    manage.session.organisationId !== book.session.organisationId ||
    manage.session.userId !== book.session.userId
  )
    return null;
  return book.session;
}

export type Squad = { id: string; name: string };
type Member = Squad & { email: string; first: string; last: string | null };
type Term = {
  id: string;
  offering: string;
  name: string;
  cents: number;
  currency: string;
  first: string;
  last: string;
  squad: string | null;
};

export async function squadDirectory(org: string) {
  return createSchedulingExecutor().query<Squad>(
    'SELECT id,name FROM scheduling_coach_squads WHERE organisation_id=$1 ORDER BY lower(name),id',
    [org],
  );
}

export async function squadDetails(org: string, id: string) {
  const db = createSchedulingExecutor();
  const [members, terms] = await Promise.all([
    db.query<Member>(
      `SELECT id,name,email,first_day::text AS first,last_day::text AS last
      FROM scheduling_coach_squad_members WHERE organisation_id=$1 AND squad_id=$2 ORDER BY lower(name),first_day`,
      [org, id],
    ),
    db.query<Term>(
      `SELECT t.id,t.offering_id AS offering,concat_ws(' · ',s.name,f.name,t.name) AS name,
      f.price_cents AS cents,f.currency,min(o.local_date)::text AS first,max(o.local_date)::text AS last,st.squad_id AS squad
      FROM scheduling_coach_terms t JOIN scheduling_offerings f ON (f.organisation_id,f.id)=(t.organisation_id,t.offering_id)
      JOIN scheduling_schedules s ON (s.organisation_id,s.id)=(f.organisation_id,f.schedule_id)
      JOIN scheduling_coach_term_dates d ON (d.organisation_id,d.offering_id,d.term_id)=(t.organisation_id,t.offering_id,t.id)
      JOIN scheduling_occurrences o ON (o.organisation_id,o.id)=(d.organisation_id,d.occurrence_id)
      LEFT JOIN scheduling_coach_squad_terms st ON (st.organisation_id,st.offering_id,st.term_id)=(t.organisation_id,t.offering_id,t.id)
      WHERE t.organisation_id=$1 AND s.id<>'tennis-coaching' AND s.preset_key='classes_coaching'
      GROUP BY t.id,t.offering_id,t.name,s.name,f.name,f.price_cents,f.currency,st.squad_id,f.archived_at,s.archived_at
      HAVING st.squad_id=$2 OR (st.squad_id IS NULL AND f.archived_at IS NULL AND s.archived_at IS NULL
        AND bool_or(o.status='scheduled' AND o.starts_at>now())) ORDER BY first,name,t.id`,
      [org, id],
    ),
  ]);
  return { members, terms };
}

export async function squadTermReview(org: string, squad: string, term: Term) {
  return createSchedulingExecutor().query<{
    id: string;
    day: string;
    time: string;
    zone: string;
    ended: boolean;
    cancelled: boolean;
    archived: boolean;
    planned: boolean;
    players: { id: string; name: string; mark: string | null; status: string }[];
  }>(
    `SELECT o.id,o.local_date::text AS day,to_char(o.local_start_time,'HH24:MI') AS time,o.timezone AS zone,
       (o.ends_at<=now() OR o.status='completed') AS ended,o.status='cancelled' AS cancelled,
       (s.archived_at IS NOT NULL OR f.archived_at IS NOT NULL) AS archived,p.version IS NOT NULL AS planned,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'mark',r.attendance,'status',r.status)
         ORDER BY lower(m.name),m.id)
         FROM scheduling_reservations r JOIN scheduling_coach_squad_members m
           ON m.organisation_id=r.organisation_id AND m.squad_id=st.squad_id
           AND r.idempotency_key='squad:'||m.id||':'||r.occurrence_id
         WHERE (r.organisation_id,r.occurrence_id)=(o.organisation_id,o.id) AND r.status<>'cancelled'),'[]') AS players
     FROM scheduling_coach_squad_terms st JOIN scheduling_coach_term_dates d USING (organisation_id,offering_id,term_id)
     JOIN scheduling_occurrences o ON (o.organisation_id,o.offering_id,o.id)=(d.organisation_id,d.offering_id,d.occurrence_id)
     JOIN scheduling_offerings f ON (f.organisation_id,f.id)=(o.organisation_id,o.offering_id)
     JOIN scheduling_schedules s ON (s.organisation_id,s.id)=(f.organisation_id,f.schedule_id)
     LEFT JOIN scheduling_coach_training_plans p ON (p.organisation_id,p.occurrence_id)=(o.organisation_id,o.id)
     WHERE st.organisation_id=$1 AND st.squad_id=$2 AND st.offering_id=$3 AND st.term_id=$4
       AND s.preset_key='classes_coaching' AND s.id<>'tennis-coaching' AND o.starts_at>=st.assigned_at
     ORDER BY o.starts_at,o.id`,
    [org, squad, term.offering, term.id],
  );
}
