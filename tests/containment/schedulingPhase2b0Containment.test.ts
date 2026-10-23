import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// These checks walk the whole source tree; on a loaded machine (the full parallel run) 5 s is not enough.
vi.setConfig({ testTimeout: 60_000 });

// Phase 2B.0 stages the capability, the CRM link and the test-organisation definition. It enables nothing and creates
// nothing. These checks read the repository so that switching Scheduling on, touching LD Tennis, or inventing a customer
// name has to change them deliberately.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const noSqlComments = (s: string) => s.replace(/--.*$/gm, '');
const noTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

const SLUG = 'zz-scheduling-internal-test';

describe('120: the capability is registered for nobody', () => {
  const sql = noSqlComments(read('scripts/scheduling/120_brainbase_capability.sql'));

  it('inserts exactly one modules row, key scheduling, active, and nothing else of substance', () => {
    const inserts = [...sql.matchAll(/INSERT INTO (\w+)/g)].map(m => m[1]);
    expect(inserts).toEqual(['modules', 'scheduling_schema_migrations']);
    expect(sql).toMatch(/VALUES \('scheduling', 'Scheduling & Bookings', '[^']+', true\)\s*ON CONFLICT \(key\) DO NOTHING/);
    expect(sql).not.toMatch(/organisation_modules\s*\(/);
    expect(sql).not.toMatch(/INSERT INTO organisation_modules/i);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE\s+FROM|DROP|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE)\b/i);
  });

  it('no script anywhere except the manual internal-test-organisation file grants any organisation the capability', () => {
    const offenders = walk(path.join(ROOT, 'scripts'), /\.(sql|ts|mjs|js|cjs|sh)$/)
      .filter(f => !rel(f).startsWith('scripts/scheduling/manual/') && !rel(f).startsWith('scripts/tests/'))
      .filter(f => {
        const t = noSqlComments(readFileSync(f, 'utf8'));
        return /organisation_modules/.test(t) && /'scheduling'/.test(t);
      })
      .map(rel);
    // 120 names organisation_modules only to check the table exists; 191 only to refuse while a row exists. Neither inserts.
    expect(offenders.sort()).toEqual(['scripts/scheduling/120_brainbase_capability.sql', 'scripts/scheduling/191_brainbase_capability_rollback.sql']);
    for (const f of offenders) expect(noSqlComments(read(f)), f).not.toMatch(/INSERT INTO organisation_modules|UPDATE organisation_modules/i);
  });

  it('the rollback deletes only the scheduling registry row and its marker, and refuses while an entitlement exists', () => {
    const rb = noSqlComments(read('scripts/scheduling/191_brainbase_capability_rollback.sql'));
    expect([...rb.matchAll(/DELETE FROM (\w+) WHERE (\w+) = '([\w.-]+)'/g)].map(m => m.slice(1, 4).join(' '))).toEqual([
      'modules key scheduling',
      'scheduling_schema_migrations version 2b.0-capability',
    ]);
    expect(rb).toMatch(/RAISE EXCEPTION 'organisation_modules still holds/);
  });

  it('the application never seeds or edits entitlements for scheduling', () => {
    const files = ['app', 'lib', 'components', 'services'].filter(d => existsSync(path.join(ROOT, d))).flatMap(d => walk(path.join(ROOT, d), /\.(ts|tsx)$/));
    const offenders = files.filter(f => !rel(f).startsWith('lib/scheduling/')).filter(f => /['"]scheduling['"]/.test(readFileSync(f, 'utf8')) && /organisation_modules|setOrganisationCapability/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('130: the CRM link never invents a customer name and never matches by name', () => {
  const sql = noSqlComments(read('scripts/scheduling/130_brainbase_crm_link.sql'));

  it('reads and writes only crm_contacts (never the LD Tennis contacts table) and only inserts', () => {
    expect(sql).not.toMatch(/(?<![a-z_])contacts\b/i);
    expect(sql).not.toMatch(/\b(bookings|sessions|session_instances|event_orders|users)\b/i);
    expect([...sql.matchAll(/INSERT INTO (\w+)/g)].map(m => m[1])).toEqual(['crm_contacts', 'scheduling_schema_migrations']);
    expect(sql).not.toMatch(/\b(UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i);
  });

  it('creates LEAD contacts from the structured, trimmed names and nothing else', () => {
    expect(sql).toMatch(/VALUES \(p_organisation_id, p_created_by, v_first, v_last, btrim\(p_email\), NULLIF\(btrim\(p_phone\), ''\), 'LEAD'\)/);
    expect(sql).toMatch(/v_first := regexp_replace\(p_first_name, '\^\[\[:space:\]\\u00a0\]\+\|\[\[:space:\]\\u00a0\]\+\$', '', 'g'\);/);
    expect(sql).toMatch(/v_last\s+:= regexp_replace\(p_last_name,\s+'\^\[\[:space:\]\\u00a0\]\+\|\[\[:space:\]\\u00a0\]\+\$', '', 'g'\);/);
    expect(sql).toMatch(/v_first IS NULL OR v_first = '' OR v_last IS NULL OR v_last = ''[\s\S]*?ERRCODE = 'SCCNM'/);
  });

  it('has no placeholder, default, split or derived value for a name', () => {
    expect(sql).not.toMatch(/COALESCE\s*\(/i);
    expect(sql).not.toMatch(/split_part|string_to_array|regexp_split|substring\s*\(|left\s*\(|right\s*\(|initcap|concat\s*\(/i);
    for (const placeholder of ["'-'", "'--'", "'.'", "'?'", "'unknown'", "'n/a'", "'na'", "'none'", "'tbc'", "'x'", "'customer'", "'guest'"]) {
      expect(sql.toLowerCase(), placeholder).not.toContain(placeholder);
    }
    // The only string literals a name can come from are the parameters; the only quoted empties are comparisons.
    expect(sql.match(/p_first_name/g)?.length).toBe(2); // the parameter and its single trim
    expect(sql.match(/p_last_name/g)?.length).toBe(2);
  });

  it('matches by organisation and normalised email only: a name appears nowhere in a WHERE clause', () => {
    const match = sql.match(/SELECT c\.id INTO v_id[\s\S]*?LIMIT 1;/)?.[0] ?? '';
    expect(match).toContain('c.organisation_id = p_organisation_id AND lower(btrim(c.email)) = v_email');
    expect(match).not.toMatch(/first_name|last_name|p_first_name|p_last_name|phone/);
  });

  it('serialises on the same advisory lock key as the Events CRM sync and refuses unsafe isolation', () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtext(p_organisation_id), hashtext('email:' || v_email))");
    const events = read('lib/crm/eventSync.ts');
    expect(events).toContain("const EMAIL_MARKER = 'email'");
    expect(events).toContain('pg_advisory_xact_lock(hashtext(${organisationId}), hashtext(${lockMarker + \':\' + lockIdentity}))');
    expect(sql).toMatch(/'repeatable read', 'serializable'[\s\S]*?ERRCODE = 'SCISO'/);
    expect(sql).toMatch(/LANGUAGE plpgsql SET lock_timeout = '5s'/);
  });

  it('the function name does not start with scheduling_, so the shared 020 inventory and fingerprints are unaffected', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION brainbase_scheduling_find_or_create_contact(');
    expect(sql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION scheduling_/i);
  });

  it('the rollback drops only that function and its marker', () => {
    const rb = noSqlComments(read('scripts/scheduling/192_brainbase_crm_link_rollback.sql'));
    expect([...rb.matchAll(/DROP (\w+) IF EXISTS (\w+)/g)].map(m => m.slice(1, 3).join(' '))).toEqual(['FUNCTION brainbase_scheduling_find_or_create_contact']);
    expect(rb).toMatch(/DELETE FROM scheduling_schema_migrations WHERE version = '2b\.0-crm-link'/);
    expect(rb).not.toMatch(/crm_contacts/);
  });
});

describe('the TypeScript modules are staged, not wired', () => {
  const sources = ['app', 'components', 'hooks', 'modules', 'services', 'store', 'lib']
    .filter(d => existsSync(path.join(ROOT, d)))
    .flatMap(d => walk(path.join(ROOT, d), /\.(ts|tsx|mts)$/))
    .concat([path.join(ROOT, 'middleware.ts')]);

  it('nothing outside lib/scheduling imports the access gate or the CRM link', () => {
    const offenders = sources.filter(f => !rel(f).startsWith('lib/scheduling/')).filter(f => /lib\/scheduling\/(access|crmLink)/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('there is still no scheduling page, cron or navigation entry, and the only scheduling routes are the two 2B.1 foundation routes', () => {
    // Deliberately updated in Phase 2B.1: app/api/scheduling now exists, but holds exactly the status and audit routes
    // (tests/containment/schedulingPhase2b1Containment.test.ts pins the guard on each). Any other route fails here.
    for (const p of ['app/api/cron/scheduling-top-up', 'app/dashboard/scheduling', 'app/scheduling', 'app/book']) expect(existsSync(path.join(ROOT, p)), p).toBe(false);
    const routes = walk(path.join(ROOT, 'app/api/scheduling'), /^route.ts$/).map(rel).sort();
    expect(routes).toEqual(['app/api/scheduling/audit/route.ts', 'app/api/scheduling/status/route.ts']);
    expect(read('components/nav/navModel.ts')).not.toMatch(/scheduling/i);
    expect(read('vercel.json')).not.toMatch(/scheduling/i);
  });

  it('the CRM link and the access gate contain no name-splitting or placeholder logic', () => {
    for (const f of ['lib/scheduling/crmLink.ts', 'lib/scheduling/access.ts']) {
      const src = noTsComments(read(f));
      expect(src, f).not.toMatch(/\.split\(|\.substring\(|\.slice\(|\.charAt\(|displayName|display_name|customer_name|customerName/);
      expect(src, f).not.toMatch(/['"](unknown|n\/a|-|\.|none|guest|customer)['"]/i);
    }
  });

  it('only crmLink.ts mentions the host function, and only access.ts reads the capability', () => {
    const fn = sources.filter(f => /find_or_create_contact/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(fn).toEqual(['lib/scheduling/crmLink.ts']);
    const cap = sources.filter(f => !rel(f).startsWith('lib/scheduling/adapters/')).filter(f => /SCHEDULING_CAPABILITY_KEY/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(cap).toEqual(['lib/scheduling/access.ts']);
  });

  it('the access gate takes no organisation parameter and reads only the session organisation', () => {
    const src = noTsComments(read('lib/scheduling/access.ts'));
    expect(src).toMatch(/export async function authorizeSchedulingRequest\(permission: SchedulingPermission\)/);
    expect(src).toContain('requireCapability(session.organisationId, SCHEDULING_CAPABILITY_KEY)');
    expect(src).not.toMatch(/headers\(|cookies\(|req\.|request\.|searchParams|\.json\(\)/);
  });
});

describe('the internal test organisation is defined but never created or enabled by code', () => {
  const dir = 'scripts/scheduling/manual';
  const files = ['internal-test-org-1-create.sql', 'internal-test-org-2-enable-capability.sql', 'internal-test-org-9-remove.sql'];

  it('ships exactly the create, enable and remove files', () => {
    expect(readdirSync(path.join(ROOT, dir)).sort()).toEqual(files);
  });

  it('creates exactly one clearly named organisation row and nothing else', () => {
    const sql = noSqlComments(read(`${dir}/${files[0]}`));
    expect([...sql.matchAll(/INSERT INTO (\w+)/g)].map(m => m[1])).toEqual(['organisations']);
    expect(sql).toContain(`'ZZ Scheduling Internal Test (no customer data)', '${SLUG}'`);
    expect(sql).toContain('ON CONFLICT (slug) DO NOTHING');
    expect(sql).not.toMatch(/organisation_modules|crm_contacts|users|stripe|scheduling_/i);
  });

  it('the enable file writes one entitlement row and one explicit settings row for that organisation, and verifies it is the only one entitled', () => {
    const sql = noSqlComments(read(`${dir}/${files[1]}`));
    expect([...sql.matchAll(/INSERT INTO (\w+)/g)].map(m => m[1])).toEqual(['organisation_modules', 'scheduling_settings']);
    // explicit (a chosen currency), and an existing row is never overwritten
    expect(sql).toMatch(/INSERT INTO scheduling_settings \(organisation_id, currency\)\s+VALUES \(org_id, 'AUD'\)\s+ON CONFLICT \(organisation_id\) DO NOTHING/);
    expect(sql).toContain(`WHERE slug = '${SLUG}'`);
    expect(sql).toMatch(/entitled <> 1/);
    expect(sql).toMatch(/n <> 1/);
  });

  it('the remove file can reach only that organisation and refuses while anything belongs to it', () => {
    const sql = noSqlComments(read(`${dir}/${files[2]}`));
    expect([...sql.matchAll(/DELETE FROM (\w+)/g)].map(m => m[1])).toEqual(['scheduling_settings', 'organisation_modules', 'organisations']);
    expect(sql).toContain(`WHERE slug = '${SLUG}'`);
    expect(sql).toContain(`WHERE id = org_id AND slug = '${SLUG}'`);
    expect(sql).toMatch(/still holds/);
  });

  it('the slug and name appear in no application code and no automated runner', () => {
    const roots = ['app', 'lib', 'components', 'services', 'scripts', '.github'].filter(d => existsSync(path.join(ROOT, d)));
    const offenders = roots
      .flatMap(d => walk(path.join(ROOT, d), /\.(ts|tsx|mjs|js|cjs|sh|yml|yaml|json)$/))
      .filter(f => !rel(f).startsWith('scripts/scheduling/manual/'))
      .filter(f => readFileSync(f, 'utf8').includes(SLUG))
      .map(rel);
    // The disposable-database proof (scripts/tests) is the only place that names it.
    expect(offenders.filter(f => !f.startsWith('scripts/tests/schedulingHost2b0') && f !== 'scripts/tests/verify-scheduling-phase2b0.sh')).toEqual([]);
  });

  it('no SQL runner executes anything from scripts/scheduling', () => {
    // Documentation may name the script paths; code must not read or execute them.
    const files2 = ['app', 'lib', 'services'].filter(d => existsSync(path.join(ROOT, d))).flatMap(d => walk(path.join(ROOT, d), /\.(ts|tsx)$/));
    const offenders = files2
      .filter(f => {
        const code = noTsComments(readFileSync(f, 'utf8'));
        return /internal-test-org/.test(code) || (/scripts\/scheduling/.test(code) && /node:fs|from 'fs'|require\('fs'\)|child_process|\.sql['"`]/.test(code));
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('LD Tennis, public booking and payments are untouched', () => {
  it('no LD Tennis file mentions the new modules or functions', () => {
    const tennis = ['app/api/tennis/book/route.ts', 'app/api/tennis/cancel/route.ts', 'app/api/dashboard/enrolments/route.ts', 'app/api/dashboard/sessions/route.ts', 'app/api/bookings/route.ts', 'lib/tennisRecurrence.ts', 'lib/tennisSchedule.ts']
      .filter(f => existsSync(path.join(ROOT, f)));
    expect(tennis.length).toBeGreaterThan(0);
    for (const f of tennis) expect(read(f), f).not.toMatch(/lib\/scheduling|crmLink|find_or_create_contact|authorizeSchedulingRequest|'scheduling'/);
  });

  it('the new code mentions no payment or public-booking integration', () => {
    for (const f of ['lib/scheduling/access.ts', 'lib/scheduling/crmLink.ts']) {
      expect(noTsComments(read(f)), f).not.toMatch(/stripe|checkout|payment_intent|publicTenantContext|app\/api\/tennis/i);
    }
  });
});

describe('the real-Postgres proof can only reach a database named by SCHEDULING_TEST_DATABASE_URL', () => {
  it('the 2B.0 integration suite never reads DATABASE_URL or a production connection variable', () => {
    const f = 'scripts/tests/schedulingHost2b0.integration.test.ts';
    expect(existsSync(path.join(ROOT, f))).toBe(true);
    const src = read(f).replace(/\/\/.*$/gm, '');
    expect(src).toContain('SCHEDULING_TEST_DATABASE_URL');
    expect(src).not.toMatch(/process\.env\.DATABASE_URL|NEON_DATABASE_URL|POSTGRES_URL|DATABASE_URL_UNPOOLED/);
  });

  it('the integration suite is listed in the integration config and not in the default run', () => {
    expect(read('vitest.integration.config.ts')).toContain("'scripts/tests/schedulingHost2b0.integration.test.ts'");
    expect(read('vitest.config.ts')).not.toContain('schedulingHost2b0');
  });
});
