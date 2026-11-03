import 'server-only';
import sql from '@/lib/db';
import { requireSession } from '@/lib/org';
import { visibleCapabilities } from '@/lib/organisationUsers/access';
import { TENNIS_BUSINESS_MODULES, type BusinessModule } from './model';

export async function tennisBusinessAccess() {
  let session;
  try { session = await requireSession(); } catch { return { ok: false as const, status: 401 as const }; }
  if (!['viewer', 'manager', 'admin', 'super_admin'].includes(session.role)) return { ok: false as const, status: 403 as const };
  try {
    const [org] = await sql`SELECT slug FROM organisations WHERE id=${session.organisationId}`;
    if (org?.slug !== 'ld-tennis') return { ok: false as const, status: 404 as const };
    const visible = await visibleCapabilities(session.organisationId, session.userId, session.role);
    const modules = TENNIS_BUSINESS_MODULES.filter(key => visible.some(row => row.key === key)) as BusinessModule[];
    if (!modules.length) return { ok: false as const, status: 403 as const };
    return { ok: true as const, session, modules };
  } catch { return { ok: false as const, status: 503 as const }; }
}
