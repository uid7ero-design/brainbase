import Link from 'next/link';

import { PublicFooter } from '@/components/public/PublicFooter';
import { ArrowIcon, ButtonLink, Container, Section, SectionHeading } from '@/components/public/primitives';
import { Badge } from '@/components/ui/semantic';
import publicStyles from '@/components/public/public.module.css';
import styles from '@/components/public/pricing/pricing.module.css';

// Public pricing page. Server component on the --bb-* token system, so it
// renders in light and dark. Copy, prices, plans and links are unchanged
// from the previous version; only presentation changed.

type Plan = {
  name: string;
  price: number | null;
  priceLabel?: string;
  tagline: string;
  description: string;
  popular: boolean;
  enterprise?: boolean;
  features: string[];
  cta: string;
};

const PLANS: Plan[] = [
  {
    name: 'Foundation',
    price: 29,
    tagline: 'Get the core operation organised',
    description:
      'A simple operational foundation for businesses ready to organise clients, leads and scheduling in one connected workspace.',
    popular: false,
    features: [
      'Client management',
      'Lead tracking',
      'Scheduling',
      'Core operational view',
      'BrainBase workspace',
      'Standard support',
    ],
    cta: 'Discuss Foundation',
  },
  {
    name: 'Operations',
    price: 59,
    tagline: 'Run more of the day-to-day work',
    description:
      'For businesses that want leads, clients, workflows and operational visibility connected in one working system.',
    popular: true,
    features: [
      'Everything in Foundation',
      'Follow-up workflows',
      'Revenue visibility',
      'Operational dashboards',
      'Workflow automation',
      'Priority operational support',
    ],
    cta: 'Discuss Operations',
  },
  {
    name: 'Business System',
    price: 99,
    tagline: 'Connect a broader part of the business',
    description:
      'For businesses ready to connect more of their operation and introduce deeper reporting, integrations and intelligence.',
    popular: false,
    features: [
      'Everything in Operations',
      'HLNA intelligence',
      'Advanced reporting',
      'Expanded workflows',
      'Business integrations',
      'Priority support',
    ],
    cta: 'Discuss Business System',
  },
  {
    name: 'Enterprise',
    price: null,
    priceLabel: 'Custom',
    tagline: 'Tailored deployment for complex organisations',
    description:
      'For larger organisations, multi-team environments and operations requiring tailored architecture, governance and implementation.',
    popular: false,
    enterprise: true,
    features: [
      'Tailored BrainBase deployment',
      'Multiple teams or business units',
      'Advanced permissions & governance',
      'Custom integrations & workflows',
      'Tailored dashboards & reporting',
      'Dedicated implementation support',
    ],
    cta: 'Talk to us',
  },
];

type Tier = 'foundation' | 'operations' | 'business' | 'enterprise';

const COMPARISON: ({ feature: string } & Record<Tier, boolean>)[] = [
  { feature: 'Client management', foundation: true, operations: true, business: true, enterprise: true },
  { feature: 'Lead tracking', foundation: true, operations: true, business: true, enterprise: true },
  { feature: 'Scheduling', foundation: true, operations: true, business: true, enterprise: true },
  { feature: 'Operational workspace', foundation: true, operations: true, business: true, enterprise: true },
  { feature: 'Follow-up workflows', foundation: false, operations: true, business: true, enterprise: true },
  { feature: 'Revenue visibility', foundation: false, operations: true, business: true, enterprise: true },
  { feature: 'Operational dashboards', foundation: false, operations: true, business: true, enterprise: true },
  { feature: 'Workflow automation', foundation: false, operations: true, business: true, enterprise: true },
  { feature: 'HLNA intelligence', foundation: false, operations: false, business: true, enterprise: true },
  { feature: 'Advanced reporting', foundation: false, operations: false, business: true, enterprise: true },
  { feature: 'Business integrations', foundation: false, operations: false, business: true, enterprise: true },
  { feature: 'Multi-team deployment', foundation: false, operations: false, business: false, enterprise: true },
  { feature: 'Advanced permissions', foundation: false, operations: false, business: false, enterprise: true },
  { feature: 'Tailored implementation', foundation: false, operations: false, business: false, enterprise: true },
];

const TIERS: Tier[] = ['foundation', 'operations', 'business', 'enterprise'];

const CHOICES = [
  {
    number: '01',
    title: 'Foundation',
    body: 'You mainly need to organise leads, clients and scheduling and create one reliable operational workspace.',
  },
  {
    number: '02',
    title: 'Operations',
    body: 'You want BrainBase actively supporting daily workflows, follow-up, visibility, dashboards and automation.',
  },
  {
    number: '03',
    title: 'Business System',
    body: 'You are ready for deeper reporting, broader integrations where supported, and HLNA intelligence across a more connected business.',
  },
  {
    number: '04',
    title: 'Enterprise',
    body: 'You need a tailored deployment across teams, business units or a more complex organisational environment.',
  },
];

const ENTERPRISE_ITEMS = [
  'Multiple teams or business units',
  'Custom operational workflows',
  'Advanced access and permissions',
  'Tailored integrations',
  'Organisation-specific reporting',
  'Dedicated implementation planning',
];

const EXTRAS = [
  {
    title: 'Setup & configuration',
    description:
      'Initial setup can include workspace configuration, workflows, forms, permissions and business-specific operating structure. A one-off setup fee may apply depending on requirements.',
  },
  {
    title: 'Website builds',
    description:
      'A new BrainBase website or redesign is separate from the monthly platform subscription and can be scoped and quoted based on the project.',
  },
  {
    title: 'Data migration',
    description:
      'Existing contacts, client information and operational records can be assessed and migrated where appropriate. Migration work may be quoted separately.',
  },
  {
    title: 'Custom integrations',
    description:
      'Connections to external systems, specialist software or custom workflows can be quoted separately based on complexity.',
  },
];

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="10"
      viewBox="0 0 10 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M1 4L4 7L9 1" />
    </svg>
  );
}

export default function PricingPage() {
  return (
    <main className={`bb-public ${publicStyles.page}`}>
      {/* HERO ─────────────────────────────────────────────────────────── */}
      <section className={`${styles.hero} bb-grid-bg`} aria-labelledby="pricing-title">
        <Container>
          <div className={styles.heroInner}>
            <p className={`bb-eyebrow ${styles.heroEyebrow}`}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              BrainBase Pricing
            </p>
            <h1 id="pricing-title" className={styles.heroTitle}>
              Start with what you need.
              <br />
              <span className={styles.heroAccent}>Expand as your operation grows.</span>
            </h1>
            <p className={styles.heroLede}>
              BrainBase pricing reflects the scope of the platform your organisation needs today. Start focused, then
              add broader capability as requirements grow.
            </p>
          </div>
        </Container>
      </section>

      <Container>
        {/* SIMPLE COMMERCIAL PRINCIPLE */}
        <div className={styles.principle}>
          <p className={styles.principleTitle}>You don&apos;t need the whole platform on day one.</p>
          <p className={styles.principleBody}>
            Start with the capabilities that solve today&apos;s problems. Broader operational capability — and
            implementation, where required — can be introduced later.
          </p>
        </div>

        {/* PRICING CARDS */}
        <ul className={`bb-cells ${styles.plans}`} aria-label="Plans">
          {PLANS.map(plan => {
            const id = `plan-${plan.name.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <li
                key={plan.name}
                className={[styles.plan, plan.popular && styles.planPopular, plan.enterprise && styles.planEnterprise]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={styles.planHead}>
                  <h2 id={id} className={styles.planName}>
                    {plan.name}
                  </h2>
                  {plan.popular && <Badge state="active">Most Popular</Badge>}
                  {plan.enterprise && <Badge state="info">Tailored</Badge>}
                </div>
                <p className={styles.planTagline}>{plan.tagline}</p>
                <p className={styles.planDescription}>{plan.description}</p>

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
                    <li key={feature} className={styles.feature}>
                      <CheckIcon className={styles.check} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link href="/request-demo" className={styles.planCta}>
                  {plan.cta}
                  <ArrowIcon />
                </Link>
              </li>
            );
          })}
        </ul>

        {/* SETUP NOTICE */}
        <div className={styles.notice}>
          <p className={`bb-eyebrow ${styles.noticeTitle}`}>Platform subscription + implementation where required</p>
          <p className={styles.noticeBody}>
            Monthly pricing covers the BrainBase platform subscription. Initial setup, configuration, data migration,
            website work and custom integrations may involve a separate implementation cost depending on your
            requirements.
          </p>
          <p className={styles.noticeFine}>Any implementation work is scoped and quoted before it begins.</p>
        </div>
      </Container>

      {/* CHOOSING A PLAN ─────────────────────────────────────────────── */}
      <Section labelledBy="choosing-title">
        <SectionHeading id="choosing-title" index="01" eyebrow="Choosing a plan" title="Start where your operation is today.">
          You do not need to deploy everything at once. Choose the level that fits your current operation and expand
          when it makes sense.
        </SectionHeading>
        <ul className={`bb-cells ${styles.ruled4}`}>
          {CHOICES.map(choice => (
            <li key={choice.number}>
              <span className={styles.cellIndex} aria-hidden="true">
                {choice.number}
              </span>
              <h3 className={styles.cellTitle}>{choice.title}</h3>
              <p className={styles.cellBody}>{choice.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* COMPARISON ──────────────────────────────────────────────────── */}
      <Section labelledBy="compare-title">
        <SectionHeading id="compare-title" index="02" eyebrow="Compare" title="What is included?">
          A high-level view of how BrainBase capability expands from a focused workspace through to a tailored
          enterprise deployment.
        </SectionHeading>

        {/* Scrolls inside itself on narrow screens, so it is keyboard-focusable. */}
        <div className={styles.tableWrap} role="region" aria-label="Plan comparison table" tabIndex={0}>
          <table className={styles.table}>
            <caption className="bb-visually-hidden">Capability included in each plan</caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {PLANS.map(plan => (
                  <th key={plan.name} scope="col">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(row => (
                <tr key={row.feature}>
                  <th scope="row">{row.feature}</th>
                  {TIERS.map(tier => (
                    <td key={tier}>
                      {row[tier] ? (
                        <>
                          <CheckIcon className={styles.tableCheck} />
                          <span className="bb-visually-hidden">Included</span>
                        </>
                      ) : (
                        <>
                          <span className={styles.tableDash} aria-hidden="true">
                            —
                          </span>
                          <span className="bb-visually-hidden">Not included</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.tableNote}>
          Business integrations connect to external systems where supported — not every integration is available for
          every plan or system.
        </p>

        {/* CONFIGURATION, NOT RIGID BUNDLES */}
        <div className={styles.config}>
          <h3 className={styles.configTitle}>The scope may be similar. The configuration can still differ.</h3>
          <p className={styles.configBody}>
            Two organisations on the same BrainBase tier can still use its capabilities differently, configured around
            how each one operates.
          </p>
        </div>
      </Section>

      {/* ENTERPRISE ──────────────────────────────────────────────────── */}
      <Section labelledBy="enterprise-title">
        <div className={styles.split}>
          <SectionHeading
            id="enterprise-title"
            index="03"
            eyebrow="Enterprise"
            title="Some operations need a system built around them."
          >
            Enterprise is for organisations where a standard subscription is not enough. Deployment can be tailored
            around organisational structure, permissions, workflows, reporting, integrations and operational
            requirements.
          </SectionHeading>
          <div className={styles.splitAside}>
            <ul className={`bb-cells ${styles.enterpriseList}`}>
              {ENTERPRISE_ITEMS.map(item => (
                <li key={item} className={styles.enterpriseItem}>
                  {item}
                </li>
              ))}
            </ul>
            <ButtonLink href="/request-demo" variant="secondary" arrow>
              Discuss Enterprise
            </ButtonLink>
          </div>
        </div>
      </Section>

      {/* IMPLEMENTATION ──────────────────────────────────────────────── */}
      <Section labelledBy="implementation-title">
        <SectionHeading
          id="implementation-title"
          index="04"
          eyebrow="Implementation"
          title="Some businesses need more than a subscription."
        >
          Implementation depends on what you want connected, how much configuration is required and what systems or
          information you already have in place.
        </SectionHeading>
        <ul className={`bb-cells ${styles.extras}`}>
          {EXTRAS.map((item, index) => (
            <li key={item.title}>
              <span className={styles.cellIndex} aria-hidden="true">
                0{index + 1}
              </span>
              <h3 className={styles.cellTitle}>{item.title}</h3>
              <p className={styles.cellBody}>{item.description}</p>
            </li>
          ))}
        </ul>
        <p className={styles.extraNote}>
          Simple deployments may require little or no additional setup. More complex deployments involving migration,
          workflow configuration, integrations, website work or enterprise requirements will be scoped and quoted before
          commencement.
        </p>
      </Section>

      {/* WEB SYSTEMS ─────────────────────────────────────────────────── */}
      <Section labelledBy="web-systems-title">
        <div className={styles.split}>
          <div>
            <SectionHeading
              id="web-systems-title"
              index="05"
              eyebrow="Web Systems"
              title="Your website can become part of the system."
            >
              BrainBase Web Systems can connect your public website to enquiries, CRM, bookings, workflows and the
              operational platform behind your business.
            </SectionHeading>
            <p className={styles.splitFine}>Website projects are scoped and quoted separately from the platform subscription.</p>
          </div>
          <div className={styles.actions}>
            <ButtonLink href="/web-systems" variant="secondary">
              Explore Web Systems
            </ButtonLink>
            <ButtonLink href="/request-demo">Discuss your project</ButtonLink>
          </div>
        </div>
      </Section>

      {/* FINAL CTA ───────────────────────────────────────────────────── */}
      <Section labelledBy="pricing-cta-title">
        <div className={`${styles.cta} bb-grid-bg`}>
          <p className="bb-eyebrow">Not sure which plan?</p>
          <h2 id="pricing-cta-title" className={styles.ctaTitle}>
            Start with the part of the operation
            <br />
            that matters most.
          </h2>
          <p className={styles.ctaBody}>
            Tell us what you need BrainBase to handle now, and we can scope the right starting point.
          </p>
          <div className={styles.ctaActions}>
            <ButtonLink href="/request-demo">Discuss your operation</ButtonLink>
            <ButtonLink href="/demo" variant="secondary">
              Explore BrainBase
            </ButtonLink>
          </div>
        </div>
      </Section>

      <PublicFooter />
    </main>
  );
}
