import Link from 'next/link';

import { BrainbaseLockup } from '@/components/public/BrainbaseLockup';
import { PublicFooter } from '@/components/public/PublicFooter';
import {
  ArrowIcon,
  ButtonLink,
  Chip,
  Container,
  Panel,
  Section,
  SectionHeading,
  TextLink,
} from '@/components/public/primitives';
import { HlnaMark } from '@/components/public/brand';
import { Badge } from '@/components/ui/semantic';
import publicStyles from '@/components/public/public.module.css';
import styles from '@/components/public/client-operations/clientOps.module.css';

// Public /client-operations page. Server component: copy, links and section
// order are unchanged from the previous version; only the presentation moved
// onto the --bb-* public design system (light + dark). Hover effects that
// were JS state are now CSS.

const WHO_FOR = [
  'Coaches & Trainers',
  'Consultants',
  'Tutors & Educators',
  'Clinics & Practitioners',
  'Clubs & Academies',
  'Service Businesses',
];

const CAPABILITY_PILLS = [
  'Leads & clients',
  'Scheduling & bookings',
  'Follow-up & workflows',
  'Operational visibility',
];

const OUTCOMES = [
  {
    title: 'Never lose an enquiry',
    description:
      'New leads enter one organised pipeline instead of disappearing across forms, messages and inboxes.',
  },
  {
    title: 'Organised client records',
    description: 'Contacts, history, activity and follow-up remain connected around each client.',
  },
  {
    title: 'Clear scheduling',
    description: 'See sessions, appointments, capacity and upcoming commitments in one operational view.',
  },
  {
    title: 'Follow-up visibility',
    description: 'Know who needs a call, email or response before opportunities go cold.',
  },
  {
    title: 'Revenue visibility',
    description: 'Understand the commercial value of your schedule, bookings and client activity.',
  },
  {
    title: 'Operational clarity',
    description: 'See the health of the business without manually piecing together separate tools.',
  },
];

const JOURNEY = [
  {
    number: '01',
    title: 'Enquiry captured',
    body: 'A prospect enters through your website, referral or enquiry channel.',
  },
  {
    number: '02',
    title: 'Lead organised',
    body: 'The enquiry appears in BrainBase with contact information and follow-up status.',
  },
  {
    number: '03',
    title: 'Client created',
    body: 'When the relationship progresses, the lead becomes an organised client record.',
  },
  {
    number: '04',
    title: 'Service scheduled',
    body: 'Sessions, appointments or service delivery are managed from the same environment.',
  },
  {
    number: '05',
    title: 'Follow-up managed',
    body: 'Calls, emails, requests and next actions stay visible to the business.',
  },
  {
    number: '06',
    title: 'Business understood',
    body: 'Dashboards and HLNA turn connected activity into operational visibility.',
  },
];

const CONFIG_DIFFERENCES = [
  'Terminology',
  'Stages',
  'Booking or service structure',
  'Follow-up requirements',
  'Information collected',
];

const START_WITH = ['Leads', 'Clients', 'Scheduling & Bookings'];

const CAPABILITIES = [
  {
    title: 'Leads',
    description: 'Capture enquiries and follow them through to a client without losing track of where things stand.',
  },
  {
    title: 'Clients & CRM',
    description: 'Manage contacts, clients and communication activity in one place.',
  },
  {
    title: 'Scheduling & Bookings',
    description: 'Manage appointments, sessions, programs and availability.',
  },
  {
    title: 'Follow-up Workflows',
    description: 'Keep incoming requests, enquiries and required actions visible.',
  },
  {
    title: 'Dashboards & Reporting',
    description: 'Bring operational activity and business indicators into one view.',
  },
  {
    title: 'HLNA Intelligence',
    description: 'Surface context, priorities and operational signals across the connected operation.',
  },
];

const HLNA_SIGNALS = ['What needs attention', 'What has changed', 'Where there are gaps', 'Operational signals'];

const EXAMPLE_KPIS = [
  { label: "Today's Sessions", value: '6', sub: 'Scheduled today' },
  { label: 'New Leads', value: '6', sub: 'Last 7 days' },
  { label: 'Follow-ups', value: '5', sub: 'Awaiting response' },
  { label: 'Open Leads', value: '7', sub: 'New or contacted' },
];

const EXAMPLE_SESSIONS = [
  { name: 'Client Session', time: '09:00–10:00', location: 'Location A' },
  { name: 'Group Program', time: '14:30–15:30', location: 'Location B' },
  { name: 'Private Appointment', time: '17:00–18:00', location: 'Location A' },
];

const EXAMPLE_ATTENTION = [
  { name: 'New website enquiry', status: 'Never contacted' },
  { name: 'Existing client', status: 'Follow-up due' },
  { name: 'New lead', status: 'Awaiting response' },
];

const DEPLOYMENT_FLOW = [
  'Website enquiries → leads',
  'Leads → organised clients',
  'Clients → scheduled sessions',
  'Follow-up → visible actions',
  'Activity → operational dashboard',
];

type ClientOperationsPlan = {
  name: string;
  tagline: string;
  price: number | null;
  priceLabel?: string;
  features: string[];
  popular: boolean;
  enterprise?: boolean;
  cta: string;
};

const PRICING: ClientOperationsPlan[] = [
  {
    name: 'Foundation',
    tagline: 'Get your operation organised',
    price: 29,
    features: ['Client management', 'Lead tracking', 'Scheduling', 'Core operational view'],
    popular: false,
    cta: 'Discuss Foundation',
  },
  {
    name: 'Operations',
    tagline: 'Run the day-to-day work',
    price: 59,
    features: ['Everything in Foundation', 'Follow-up workflows', 'Revenue visibility', 'Operational dashboards'],
    popular: true,
    cta: 'Discuss Operations',
  },
  {
    name: 'Business System',
    tagline: 'Connect the broader business',
    price: 99,
    features: ['Everything in Operations', 'HLNA intelligence', 'Advanced reporting', 'Business integrations'],
    popular: false,
    cta: 'Discuss Business System',
  },
  {
    name: 'Enterprise',
    tagline: 'Tailored deployment at scale',
    price: null,
    priceLabel: 'Custom',
    features: [
      'Tailored BrainBase deployment',
      'Multiple teams or business units',
      'Advanced permissions & governance',
      'Custom integrations & workflows',
    ],
    popular: false,
    enterprise: true,
    cta: 'Talk to us',
  },
];

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
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

export default function ClientOperations() {
  return (
    <main className={`bb-public ${publicStyles.page}`}>
      {/* 1. HERO ─────────────────────────────────────────────────────── */}
      <section className={`${styles.hero} bb-grid-bg`} aria-labelledby="client-ops-title">
        <Container className={styles.heroInner}>
          <Link href="/" className={styles.backLink}>
            ← Back to BrainBase
          </Link>

          <div className={styles.heroBody}>
            <BrainbaseLockup idPrefix="bb-client-ops-lockup" width={200} className={styles.heroLockup} title="BrainBase" />

            <p className={`bb-eyebrow ${styles.heroEyebrow}`}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              Client Operations
            </p>

            <h1 id="client-ops-title" className={styles.heroTitle}>
              Run the client journey
              <br />
              <span className={styles.heroAccent}>in one connected place.</span>
            </h1>

            <p className={styles.heroLede}>
              BrainBase Client Operations connects enquiries, clients, bookings, follow-up and operational visibility in
              one environment configured around how your business works.
            </p>

            <div className={styles.heroActions}>
              <ButtonLink href="/client-operations/demo">Explore the Client Operations demo</ButtonLink>
              <ButtonLink href="/request-demo" variant="secondary">
                Discuss your operation
              </ButtonLink>
            </div>

            <ul className={styles.pillList}>
              {CAPABILITY_PILLS.map(pill => (
                <li key={pill}>{pill}</li>
              ))}
            </ul>

            <div className={styles.whoFor}>
              <p className="bb-eyebrow">Designed for client &amp; service businesses</p>
              <ul className={styles.chipRow}>
                {WHO_FOR.map(item => (
                  <li key={item}>
                    <Chip>{item}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      {/* 2. THE PROBLEM ──────────────────────────────────────────────── */}
      <Section labelledBy="client-ops-problem">
        <SectionHeading
          id="client-ops-problem"
          index="01"
          eyebrow="The problem"
          title="Your client journey shouldn't depend on manual hand-offs."
        >
          The problem usually isn&apos;t any single tool — it&apos;s the gaps between them.
        </SectionHeading>

        <div className={styles.compare}>
          <div className={styles.compareBefore}>
            <p className={`bb-eyebrow ${styles.compareLabel}`}>
              <span className={styles.shapeGap} aria-hidden="true" />
              Before
            </p>
            <p className={styles.compareBody}>
              An enquiry arrives through the website. It gets copied into a spreadsheet or CRM. Scheduling lives in a
              calendar. Follow-up sits in email. Reporting happens somewhere else.
            </p>
          </div>
          <div className={styles.compareAfter}>
            <p className={`bb-eyebrow ${styles.compareLabel} ${styles.compareLabelAfter}`}>
              <span className={styles.shapeLinked} aria-hidden="true" />
              With BrainBase
            </p>
            <p className={styles.compareBodyStrong}>
              Leads, clients, scheduling, follow-up and operational context stay connected in one environment.
            </p>
          </div>
        </div>
      </Section>

      {/* 3. THE CONNECTED JOURNEY ────────────────────────────────────── */}
      <Section labelledBy="client-ops-journey">
        <SectionHeading
          id="client-ops-journey"
          index="02"
          eyebrow="Connected journey"
          title="From first enquiry to ongoing client."
        >
          Each stage of the client journey stays connected to the next. The exact stages and terminology can vary by
          business.
        </SectionHeading>

        <ol className={styles.journey}>
          {JOURNEY.map(step => (
            <li key={step.number} className={styles.journeyStep}>
              <span className={styles.journeyNumber}>{step.number}</span>
              <div>
                <h3 className={styles.itemTitle}>{step.title}</h3>
                <p className={styles.itemBody}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* OPERATIONAL IMPACT ──────────────────────────────────────────── */}
      <Section labelledBy="client-ops-impact">
        <SectionHeading id="client-ops-impact" index="03" eyebrow="Operational impact" title="Less admin. More control.">
          BrainBase removes operational friction around the work a client-based business already does every day.
        </SectionHeading>

        <ul className={`bb-cells ${styles.ruledGrid}`}>
          {OUTCOMES.map(outcome => (
            <li key={outcome.title}>
              <span className={styles.cellMark} aria-hidden="true" />
              <h3 className={styles.itemTitle}>{outcome.title}</h3>
              <p className={styles.itemBody}>{outcome.description}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 4. CONFIGURED TO YOUR OPERATION ─────────────────────────────── */}
      <Section labelledBy="client-ops-config">
        <div className={styles.split}>
          <SectionHeading
            id="client-ops-config"
            index="04"
            eyebrow="Configured to your operation"
            title="Your client process doesn't have to look like everyone else's."
          >
            Terminology, stages, booking or service structure, follow-up requirements and the information you collect can
            all differ by business.
          </SectionHeading>

          <Panel title="configuration / what can differ">
            <ul className={styles.chipRow}>
              {CONFIG_DIFFERENCES.map(item => (
                <li key={item}>
                  <Chip>{item}</Chip>
                </li>
              ))}
            </ul>
            <p className={styles.caption}>Same BrainBase capabilities. Configured around your operation.</p>
          </Panel>
        </div>
      </Section>

      {/* 5. START WITH WHAT YOU NEED ─────────────────────────────────── */}
      <Section labelledBy="client-ops-start">
        <div className={styles.split}>
          <SectionHeading
            id="client-ops-start"
            index="05"
            eyebrow="Start with what you need"
            title="You don't need the whole platform to get started."
          >
            Many client-based businesses begin with just a few capabilities.
          </SectionHeading>

          <Panel title="starting configuration">
            <ul className={styles.chipRow}>
              {START_WITH.map(item => (
                <li key={item}>
                  <Chip tone="accent">{item}</Chip>
                </li>
              ))}
            </ul>
            <p className={styles.caption}>
              Add more BrainBase capabilities as your operation grows. This is one way into the wider BrainBase
              platform.
            </p>
          </Panel>
        </div>
      </Section>

      {/* 6. CORE CAPABILITIES ────────────────────────────────────────── */}
      <Section labelledBy="client-ops-capabilities">
        <div>
          <SectionHeading
            id="client-ops-capabilities"
            index="06"
            eyebrow="Core capabilities"
            title="The capabilities behind Client Operations."
          >
            Each capability can be configured around how your business actually operates.
          </SectionHeading>

          <ul className={`bb-cells ${styles.capabilityGrid}`}>
            {CAPABILITIES.map(capability => (
              <li key={capability.title}>
                <h3 className={styles.itemTitle}>
                  <span className={styles.capabilityDot} aria-hidden="true" />
                  {capability.title}
                </h3>
                <p className={styles.itemBody}>{capability.description}</p>
              </li>
            ))}
          </ul>

          <p className={styles.hlnaMeta}>
            <span className="bb-eyebrow">Intelligence layer</span>
            <HlnaMark />
          </p>
        </div>
      </Section>

      {/* 7. EXTERNAL SYSTEMS ─────────────────────────────────────────── */}
      <Section labelledBy="client-ops-external">
        <div className={styles.split}>
          <SectionHeading
            id="client-ops-external"
            index="07"
            eyebrow="External systems"
            title="Connect the systems that already make sense."
          >
            BrainBase doesn&apos;t need to replace every specialist system your business relies on. External systems can
            connect where it helps keep the operation in one place.
          </SectionHeading>

          <div className={styles.external}>
            <span className={styles.externalLine} aria-hidden="true" />
            <Chip tone="signal">Microsoft 365 — external system example</Chip>
            <p className={styles.caption}>
              Shown as an example — not every integration is available for every system.
            </p>
          </div>
        </div>
      </Section>

      {/* 8. OPERATIONAL VISIBILITY ───────────────────────────────────── */}
      <Section labelledBy="client-ops-visibility">
        <SectionHeading
          id="client-ops-visibility"
          index="08"
          eyebrow="Operational visibility"
          title="One operational view of the business."
        >
          Instead of piecing together enquiries, clients, bookings and follow-up across separate tools, the business gets
          a clearer picture in one place.
        </SectionHeading>

        <Panel
          as="figure"
          className={styles.examplePanel}
          title={
            <span className={styles.exampleTabs}>
              <HlnaMark className={styles.exampleHlna} />
              {['Leads', 'Clients', 'Scheduling', 'Requests', 'Reporting'].map(item => (
                <span key={item} className={styles.exampleTab}>
                  {item}
                </span>
              ))}
            </span>
          }
          meta={<Badge state="info">EXAMPLE VIEW</Badge>}
          bodyClassName={styles.exampleBody}
        >
          <div className={styles.exampleHead}>
            <p className="bb-eyebrow">
              <HlnaMark /> · Client Operations
            </p>
            <h3 className={styles.exampleTitle}>Operational Dashboard</h3>
            <p className={styles.itemBody}>Leads, clients, sessions and follow-up activity — shown with example data.</p>
          </div>

          <dl className={styles.kpis}>
            {EXAMPLE_KPIS.map(card => (
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
                <span className={styles.paneAction}>View Schedule →</span>
              </p>
              <ul className={styles.paneList}>
                {EXAMPLE_SESSIONS.map(session => (
                  <li key={session.name} className={styles.session}>
                    <span className={styles.sessionName}>{session.name}</span>
                    <span className={styles.sessionMeta}>
                      {session.time} · {session.location}
                    </span>
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
                {EXAMPLE_ATTENTION.map(client => (
                  <li key={client.name} className={styles.attention}>
                    <span>
                      <span className={styles.sessionName}>{client.name}</span>
                      <span className={styles.sessionMeta}>{client.status}</span>
                    </span>
                    <span className={styles.attentionActions}>
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

      {/* 9. HLNA ─────────────────────────────────────────────────────── */}
      <Section labelledBy="client-ops-hlna">
        <SectionHeading
          id="client-ops-hlna"
          index="09"
          eyebrow="Inside BrainBase"
          title="HLNA — intelligence across the client operation."
        >
          When client, booking, workflow and activity information is connected, HLNA can help surface what needs
          attention, what has changed and where there are gaps.
        </SectionHeading>
        <div>
          <ul className={styles.chipRow}>
            {HLNA_SIGNALS.map(signal => (
              <li key={signal}>
                <Chip>{signal}</Chip>
              </li>
            ))}
          </ul>
          <div className={styles.linkRow}>
            <TextLink href="/client-operations/demo">See HLNA in the Client Operations demo</TextLink>
          </div>
        </div>
      </Section>

      {/* 10. REAL DEPLOYMENT ─────────────────────────────────────────── */}
      <Section labelledBy="client-ops-deployment">
        <Panel title="deployments / ld-tennis" meta={<Badge state="success">Real deployment</Badge>}>
          <div className={styles.deployment}>
            <div>
              <p className="bb-eyebrow">Real deployment example</p>
              <h2 id="client-ops-deployment" className={styles.deploymentTitle}>
                LD Tennis
              </h2>
              <p className={styles.bodyText}>
                A real BrainBase deployment, configured around how LD Tennis operates. LD Tennis connects website
                enquiries, leads, clients, coaching sessions, follow-up and operational reporting through the same
                BrainBase platform.
              </p>
              <TextLink href="/client-operations/demo">Explore the deployment</TextLink>
            </div>

            <ul className={styles.flowList}>
              {DEPLOYMENT_FLOW.map(item => (
                <li key={item}>
                  <CheckIcon />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </Section>

      {/* 11. THE WIDER PLATFORM ──────────────────────────────────────── */}
      <Section labelledBy="client-ops-wider">
        <SectionHeading
          id="client-ops-wider"
          index="10"
          eyebrow="The wider platform"
          title="Start here. Expand when you need to."
        >
          Client Operations is a starting configuration of BrainBase — not the limit of the platform. Additional
          capabilities can be introduced as your operation grows.
        </SectionHeading>
      </Section>

      {/* 12. PRICING ─────────────────────────────────────────────────── */}
      <Section labelledBy="client-ops-pricing">
        <SectionHeading
          id="client-ops-pricing"
          index="11"
          eyebrow="BrainBase pricing"
          title="Start small. Expand as you connect more."
        >
          Client Operations can begin as a focused workspace and expand into a broader BrainBase deployment as your
          workflows, reporting and intelligence requirements grow.
        </SectionHeading>

        <ul className={`bb-cells ${styles.plans}`}>
          {PRICING.map(plan => (
            <li
              key={plan.name}
              className={`${styles.plan} ${plan.popular ? styles.planPopular : ''} ${
                plan.enterprise ? styles.planEnterprise : ''
              }`}
            >
              <div className={styles.planHead}>
                <h3 className={styles.planName}>{plan.name}</h3>
                {plan.popular && <Badge state="active">MOST POPULAR</Badge>}
                {plan.enterprise && <Badge state="info">TAILORED</Badge>}
              </div>
              <p className={styles.planTagline}>{plan.tagline}</p>

              <p className={styles.price}>
                {plan.price !== null ? (
                  <>
                    <span className={styles.priceValue}>${plan.price}</span>
                    <span className={styles.pricePeriod}>/ month</span>
                  </>
                ) : (
                  <span className={styles.priceValue}>{plan.priceLabel}</span>
                )}
              </p>
              <p className={styles.priceNote}>
                {plan.enterprise ? 'Scoped to your organisation' : 'Platform subscription'}
              </p>

              <ul className={styles.features}>
                {plan.features.map(feature => (
                  <li key={feature}>
                    <CheckIcon />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href="/request-demo"
                className={plan.popular ? styles.planCtaPrimary : styles.planCta}
              >
                {plan.cta}
                <ArrowIcon className={styles.planArrow} />
              </Link>
            </li>
          ))}
        </ul>

        <div className={styles.pricingNote}>
          <p className={styles.pricingNoteTitle}>Platform subscription + implementation where required.</p>
          <p className={styles.itemBody}>
            Monthly pricing covers the BrainBase platform subscription. Initial configuration, data migration, website
            work and custom integrations may involve separate implementation costs depending on your requirements. Any
            additional costs are scoped and quoted before work begins.
          </p>
          <div className={styles.linkRow}>
            <TextLink href="/pricing">View full BrainBase pricing</TextLink>
          </div>
        </div>
      </Section>

      {/* 13. FINAL CTA ───────────────────────────────────────────────── */}
      <Section labelledBy="client-ops-cta">
        <div className={`${styles.cta} bb-grid-bg`}>
          <p className="bb-eyebrow">Build your client operation</p>
          <h2 id="client-ops-cta" className={styles.ctaTitle}>
            Bring your client operation together.
          </h2>
          <p className={styles.ctaBody}>
            Whether you run coaching sessions, consultations, appointments, programs or another client-based service,
            BrainBase can provide the operational system behind the work.
          </p>
          <div className={styles.ctaActions}>
            <ButtonLink href="/request-demo">Discuss your operation</ButtonLink>
            <ButtonLink href="/client-operations/demo" variant="secondary">
              Explore the demo
            </ButtonLink>
          </div>
        </div>
      </Section>

      <PublicFooter />
    </main>
  );
}
