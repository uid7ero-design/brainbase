import Link from 'next/link';

import { BrainbaseLockup } from '@/components/public/BrainbaseLockup';
import { PublicFooter } from '@/components/public/PublicFooter';
import { ButtonLink, Container, Panel, Section, SectionHeading } from '@/components/public/primitives';
import {
  ATTENTION,
  DASHBOARD_TABS,
  DEPLOYMENT_INCLUDES,
  FLOW,
  KPI_CARDS,
  MODULES,
  SESSIONS,
  TODAY_SCHEDULE,
} from '@/components/public/client-operations-demo/content';
import { HlnaMark } from '@/components/public/brand';
import { Badge } from '@/components/ui/semantic';
import publicStyles from '@/components/public/public.module.css';
import styles from '@/components/public/client-operations-demo/clientOpsDemo.module.css';

// Public /client-operations/demo page. Server component: copy, links and
// section order are unchanged from the previous version; the hover-only
// state became CSS and every colour is a --bb-* token, so the page renders
// in both themes and matches the /client-operations visual system.

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={styles.check}
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

export default function ClientOperationsDemoPage() {
  return (
    <main className={`bb-public ${publicStyles.page}`}>
      {/* HERO ──────────────────────────────────────────────────────────── */}
      <section className={`${styles.hero} bb-grid-bg`} aria-labelledby="co-demo-title">
        <Container className={styles.heroInner}>
          <Link href="/client-operations" className={styles.backLink}>
            ← Back to Client Operations
          </Link>

          <div className={styles.heroBody}>
            <BrainbaseLockup idPrefix="bb-co-demo-lockup" width={200} className={styles.heroLockup} title="BrainBase" />

            <p className={`bb-eyebrow ${styles.heroEyebrow}`}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              Client Operations Demo
            </p>

            <h1 id="co-demo-title" className={styles.heroTitle}>
              See the system
              <br />
              <span className={styles.heroAccent}>behind the business.</span>
            </h1>

            <p className={styles.heroLede}>
              Explore how BrainBase connects leads, clients, bookings, follow-up and operational visibility for
              businesses built around customer relationships and service delivery.
            </p>
          </div>
        </Container>
      </section>

      {/* OPERATIONAL DASHBOARD ─────────────────────────────────────────── */}
      <Section labelledBy="co-demo-dashboard">
        <SectionHeading
          id="co-demo-dashboard"
          index="01"
          eyebrow="Operational Dashboard"
          title="Start with what needs attention."
        >
          The dashboard gives the business a quick operational picture before anyone has to dig through separate
          systems.
        </SectionHeading>

        <Panel
          as="figure"
          className={styles.examplePanel}
          title={
            <span className={styles.exampleTabs}>
              <HlnaMark className={styles.exampleHlna} />
              {DASHBOARD_TABS.map(item => (
                <span key={item} className={styles.exampleTab}>
                  {item}
                </span>
              ))}
            </span>
          }
          meta={<Badge state="info">DEMO</Badge>}
          bodyClassName={styles.exampleBody}
        >
          <div className={styles.exampleHead}>
            <p className="bb-eyebrow">
              <HlnaMark /> · Client Operations
            </p>
            <h3 className={styles.exampleTitle}>Client Operations Dashboard</h3>
            <p className={styles.itemBody}>Leads, clients, bookings and follow-up activity</p>
          </div>

          <dl className={styles.kpis}>
            {KPI_CARDS.map(card => (
              <div key={card.label} className={styles.kpi}>
                <dt className={styles.kpiLabel}>{card.label}</dt>
                <dd className={styles.kpiValue}>{card.value}</dd>
                <dd className={styles.kpiSub}>{card.sub}</dd>
              </div>
            ))}
          </dl>

          <div className={styles.exampleColumns}>
            <div className={styles.examplePane}>
              <p className={styles.paneHeader}>
                <span>Today&apos;s Schedule</span>
                <span className={styles.paneAction}>View Bookings →</span>
              </p>
              <ul className={styles.paneList}>
                {TODAY_SCHEDULE.map(item => (
                  <li key={item.name} className={styles.session}>
                    <span className={styles.sessionName}>{item.name}</span>
                    <span className={styles.sessionMeta}>{item.detail}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className={styles.examplePane}>
              <p className={styles.paneHeader}>
                <span>Needs Attention</span>
                <span className={styles.paneAction}>All Clients →</span>
              </p>
              <ul className={styles.paneList}>
                {ATTENTION.map(item => (
                  <li key={item.name} className={styles.attention}>
                    <span className={styles.attentionText}>
                      <span className={styles.sessionName}>{item.name}</span>
                      <span className={styles.sessionMeta}>{item.status}</span>
                    </span>
                    <span className={styles.attentionActions}>
                      <span className={item.type === 'Lead' ? styles.typeLead : styles.typeClient}>{item.type}</span>
                      <span className={styles.miniTag}>Call</span>
                      <span className={styles.miniTag}>Email</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </Section>

      {/* SCHEDULING ────────────────────────────────────────────────────── */}
      <Section labelledBy="co-demo-scheduling">
        <SectionHeading id="co-demo-scheduling" index="02" eyebrow="Scheduling" title="See the week clearly.">
          The scheduling layer shows when services are running, where they are happening and how much capacity
          remains.
        </SectionHeading>

        <div className={styles.week}>
          <div className={styles.weekHead}>
            <div>
              <h3 className={styles.weekTitle}>Bookings &amp; Sessions</h3>
              <p className={styles.sessionMeta}>Week of 24–30 August</p>
            </div>
            <div className={styles.weekControls}>
              <span className={styles.miniTag}>Week</span>
              <span className={styles.newBooking}>+ New Booking</span>
            </div>
          </div>

          <ul className={styles.weekGrid}>
            {SESSIONS.map(session => (
              <li key={`${session.day}-${session.title}`} className={styles.weekItem}>
                <span className={styles.weekItemTop}>
                  <span className={styles.weekDay}>{session.day}</span>
                  <span className={styles.capacity}>
                    <span className="bb-visually-hidden">Capacity </span>
                    {session.capacity}
                  </span>
                </span>
                <span className={styles.sessionName}>{session.title}</span>
                <span className={styles.itemBody}>{session.program}</span>
                <span className={styles.sessionMeta}>
                  {session.time}
                  <br />
                  {session.venue}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* CONNECTED WORKFLOW ────────────────────────────────────────────── */}
      <Section labelledBy="co-demo-flow">
        <SectionHeading
          id="co-demo-flow"
          index="03"
          eyebrow="Connected Workflow"
          title="The value is what happens between the screens."
        >
          BrainBase keeps each stage of the client journey connected instead of treating leads, clients, bookings and
          follow-up as separate jobs.
        </SectionHeading>

        <ol className={`bb-cells ${styles.flow}`}>
          {FLOW.map(step => (
            <li key={step.number} className={styles.flowStep}>
              <span className={styles.flowNumber} aria-hidden="true">
                {step.number}
              </span>
              <div>
                <h3 className={styles.itemTitle}>{step.title}</h3>
                <p className={styles.itemBody}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* MODULES ───────────────────────────────────────────────────────── */}
      <Section labelledBy="co-demo-modules">
        <div>
          <SectionHeading
            id="co-demo-modules"
            index="04"
            eyebrow="BrainBase Platform"
            title="One operation. Multiple connected modules."
          >
            Client Operations is one configuration of BrainBase. Modules, terminology and workflows can be adapted
            around the way each business manages its clients and delivers its services.
          </SectionHeading>

          <ul className={`bb-cells ${styles.modules}`}>
            {MODULES.map(module => (
              <li key={module.title}>
                <h3 className={styles.itemTitle}>
                  <span className={styles.moduleDot} aria-hidden="true" />
                  {module.title}
                </h3>
                <p className={styles.itemBody}>{module.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* REAL DEPLOYMENT ───────────────────────────────────────────────── */}
      <Section labelledBy="co-demo-deployment">
        <SectionHeading
          id="co-demo-deployment"
          index="05"
          eyebrow="Real Deployment Example"
          title="The same platform, configured around a real business."
        >
          Client Operations is designed to adapt to the terminology, workflow and service model of each organisation.
        </SectionHeading>

        <Panel title="deployments / ld-tennis" meta={<Badge state="success">LIVE DEPLOYMENT</Badge>}>
          <div className={styles.deployment}>
            <div>
              <h3 className={styles.deploymentTitle}>LD Tennis</h3>
              <p className={styles.bodyText}>
                LD Tennis is the first live Client Operations deployment built on BrainBase. The same platform is
                configured around a coaching business, connecting website enquiries, leads, clients, sessions,
                follow-up and day-to-day operational visibility.
              </p>
            </div>

            <div className={styles.includes}>
              <p className="bb-eyebrow">Current deployment includes</p>
              <ul className={styles.checkList}>
                {DEPLOYMENT_INCLUDES.map(item => (
                  <li key={item}>
                    <CheckIcon />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </Section>

      {/* FINAL CTA ─────────────────────────────────────────────────────── */}
      <Section labelledBy="co-demo-cta">
        <div className={`${styles.cta} bb-grid-bg`}>
          <p className="bb-eyebrow">Your deployment</p>
          <h2 id="co-demo-cta" className={styles.ctaTitle}>
            The same foundation can be built around your operation.
          </h2>
          <p className={styles.ctaBody}>
            Whether your business runs appointments, consultations, coaching sessions, programs or other client
            services, BrainBase can be configured around your terminology, workflows and day-to-day operation.
          </p>
          <div className={styles.ctaActions}>
            <ButtonLink href="/request-demo">Build this for my business</ButtonLink>
            <ButtonLink href="/client-operations" variant="secondary">
              Back to Client Operations
            </ButtonLink>
          </div>
        </div>
      </Section>

      <PublicFooter />
    </main>
  );
}
