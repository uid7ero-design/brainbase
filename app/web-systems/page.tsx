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
import {
  DEPLOYMENT_CHAIN,
  EXPAND_INTO,
  FLOW,
  HERO_POINTS,
  MANAGED,
  OUTCOMES,
  PROBLEM_POINTS,
  PROCESS,
  SERVICES,
  START_WITH,
  SYSTEM_CONNECTIONS,
} from '@/components/public/web-systems/content';
import { DeploymentOptions } from '@/components/public/web-systems/DeploymentOptions';
import { Badge } from '@/components/ui/semantic';
import publicStyles from '@/components/public/public.module.css';
import styles from '@/components/public/web-systems/web-systems.module.css';

// /web-systems — BRΛINBΛSE Web Systems. Server component on the --bb-*
// public visual system; the only client island is DeploymentOptions (the
// deployment cards + EnquiryModal). Copy is unchanged from the previous
// page (see components/public/web-systems/content.ts).

export default function WebSystemsPage() {
  return (
    <main className={`bb-public ${publicStyles.page}`}>
      {/* HERO ─────────────────────────────────────────────────────────── */}
      <section className={`${styles.hero} bb-grid-bg`} aria-labelledby="web-systems-title">
        <Container>
          <Link href="/" className={styles.backLink}>
            <span aria-hidden="true">←</span> Back to BRΛINBΛSE
          </Link>

          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              {/* Page-level product mark, as before — now the theme-aware lockup.
                  Decorative: the eyebrow below names the product. */}
              <BrainbaseLockup idPrefix="bb-ws-hero-lockup" width={220} title={null} className={styles.heroLockup} />
              <p className={`bb-eyebrow ${styles.heroEyebrow}`}>
                <span className={styles.eyebrowDot} aria-hidden="true" />
                BRΛINBΛSE Web Systems
              </p>
              <h1 id="web-systems-title" className={styles.heroTitle}>
                Start with your website.
                <br />
                <span className={styles.heroAccent}>Build the system behind it.</span>
              </h1>
              <p className={styles.heroLede}>
                BRΛINBΛSE Web Systems connects the customer-facing experience with the operational work behind it —
                enquiries, client information, workflows, bookings and reporting where required.
              </p>
              <div className={styles.heroActions}>
                <ButtonLink href="/request-demo">Discuss your website</ButtonLink>
                <ButtonLink href="/demo" variant="secondary">
                  Explore BRΛINBΛSE
                </ButtonLink>
              </div>
              <ul className={styles.heroPoints}>
                {HERO_POINTS.map(point => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>

            <Panel
              as="figure"
              title="brainbase / web system"
              meta={<Badge state="success">Connected</Badge>}
              className={styles.stackPanel}
              bodyClassName={styles.stackBody}
            >
              <figcaption className="bb-visually-hidden">
                How a BRΛINBΛSE web system is layered: the website feeds lead capture, which connects to CRM,
                bookings, automation and dashboards, all running on the BRΛINBΛSE platform.
              </figcaption>
              <ol className={styles.stack}>
                <li className={styles.layer}>
                  <span className={styles.layerTitle}>Website</span>
                  <span className={styles.layerDetail}>Design · Content · Customer experience</span>
                </li>
                <li className={styles.layer}>
                  <span className={styles.layerTitle}>Lead Capture</span>
                  <span className={styles.layerDetail}>Forms · Enquiries · Conversion</span>
                </li>
                <li className={`${styles.layer} ${styles.layerConnections}`}>
                  <span className="bb-eyebrow">Connected to</span>
                  <span className={styles.connectionGrid}>
                    {SYSTEM_CONNECTIONS.map(item => (
                      <span key={item} className={styles.connection}>
                        {item}
                      </span>
                    ))}
                  </span>
                </li>
                <li className={`${styles.layer} ${styles.layerCore}`}>
                  <span className={styles.layerTitle}>BRΛINBΛSE</span>
                  <span className={styles.layerDetail}>Operations · Insight · Intelligence</span>
                </li>
              </ol>
              <p className={styles.stackFoot}>
                <span>Managed infrastructure</span>
                <span className={styles.stackFootAccent}>HLNΛ ready</span>
              </p>
            </Panel>
          </div>
        </Container>
      </section>

      {/* 01 THE PROBLEM ─────────────────────────────────────────────── */}
      <Section labelledBy="ws-problem-title">
        <div className={styles.problem}>
          <SectionHeading
            id="ws-problem-title"
            index="01"
            eyebrow="The problem"
            title="Your website shouldn't stop at the inbox."
          >
            The problem usually isn&apos;t the website — it&apos;s what happens after someone submits a form.
          </SectionHeading>
          <div className={styles.problemVisual}>
            <ul className={styles.inbox} aria-label="What happens after a form is submitted">
              {PROBLEM_POINTS.map(point => (
                <li key={point}>
                  <Chip tone="ghost">{point}</Chip>
                </li>
              ))}
            </ul>
            <p className={styles.statement}>The website is only the front door.</p>
          </div>
        </div>
      </Section>

      {/* 02 CONNECTED JOURNEY ───────────────────────────────────────── */}
      <Section labelledBy="ws-journey-title">
        <SectionHeading
          id="ws-journey-title"
          index="02"
          eyebrow="Connected journey"
          title="From website visitor to organised operation."
        >
          The customer-facing experience can feed directly into the wider operational environment. The exact flow can
          vary by business.
        </SectionHeading>

        <ol className={styles.journey}>
          {FLOW.map(step => (
            <li key={step.number} className={styles.journeyStep}>
              <span className={styles.journeyIndex}>{step.number}</span>
              <h3 className={styles.cellTitle}>{step.title}</h3>
              <p className={styles.cellBody}>{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* 03 WHAT WE BUILD ───────────────────────────────────────────── */}
      <Section id="what-we-build" labelledBy="ws-build-title">
        <SectionHeading id="ws-build-title" index="03" eyebrow="What we build" title="More than a website.">
          Start with the digital presence you need today, then connect more of the business as the value becomes
          clear.
        </SectionHeading>

        <ul className={styles.serviceGrid}>
          {SERVICES.map((service, i) => (
            <li key={service.title} className={styles.service}>
              <span className={styles.serviceIndex} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className={styles.serviceTitle}>{service.title}</h3>
              <p className={styles.cellBody}>{service.description}</p>
              <ul className={styles.tagRow} aria-label={`${service.title} includes`}>
                {service.tags.map(tag => (
                  <li key={tag}>
                    <Chip>{tag}</Chip>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      {/* 04 WHY CONNECT IT ──────────────────────────────────────────── */}
      <Section labelledBy="ws-why-title">
        <SectionHeading
          id="ws-why-title"
          index="04"
          eyebrow="Why connect it"
          title="Make the website useful after the form is submitted."
        >
          The biggest improvement often happens behind the website — where enquiries, follow-up and operational work
          begin.
        </SectionHeading>

        <ul className={styles.outcomes}>
          {OUTCOMES.map(item => (
            <li key={item.title} className={styles.outcome}>
              <h3 className={styles.cellTitle}>{item.title}</h3>
              <p className={styles.cellBody}>{item.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 05 BUILT TO CONNECT ───────────────────────────────────────── */}
      <Section labelledBy="ws-connect-title">
        <div className={styles.connectRow}>
          <SectionHeading
            id="ws-connect-title"
            index="05"
            eyebrow="Built to connect"
            title="Built to connect with the operation behind it."
          >
            A BRΛINBΛSE website isn&apos;t valuable because of the framework it&apos;s built on. It&apos;s valuable
            because customer-facing actions — enquiries, bookings, follow-up — can feed directly into BRΛINBΛSE
            capabilities where appropriate.
          </SectionHeading>
          <p className={styles.frontDoor}>
            The website is the front door. <span className={styles.accentText}>BRΛINBΛSE</span>{' '}
            is what&apos;s behind it.
          </p>
        </div>
      </Section>

      {/* 06 START WITH THE WEBSITE ─────────────────────────────────── */}
      <Section labelledBy="ws-start-title">
        <SectionHeading
          id="ws-start-title"
          index="06"
          eyebrow="Start with the website"
          title="Start with the front door."
        >
          Connect more when the business needs it.
        </SectionHeading>

        <div className={styles.expand}>
          <div className={styles.expandGroup}>
            <p className="bb-eyebrow">Start with</p>
            <div className={styles.chipRow}>
              {START_WITH.map(item => (
                <Chip key={item} tone="accent">
                  {item}
                </Chip>
              ))}
            </div>
          </div>
          <div className={styles.expandArrow} aria-hidden="true">
            <ArrowIcon />
          </div>
          <div className={styles.expandGroup}>
            <p className="bb-eyebrow">Then expand into</p>
            <div className={styles.chipRow}>
              {EXPAND_INTO.map(item => (
                <Chip key={item} tone="ghost">
                  {item}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* 07 EXTERNAL SYSTEMS ───────────────────────────────────────── */}
      <Section labelledBy="ws-external-title">
        <div className={styles.external}>
          <SectionHeading
            id="ws-external-title"
            index="07"
            eyebrow="External systems"
            title="Connect the systems that already make sense."
          >
            BRΛINBΛSE doesn&apos;t need to replace every specialist system your business relies on. It can connect
            with external systems where it makes sense.
          </SectionHeading>
          <div className={styles.externalExample}>
            <Chip tone="signal">Microsoft 365 — external system example</Chip>
            <p className={styles.note}>Shown as an example — not every integration is available for every system.</p>
          </div>
        </div>
      </Section>

      {/* REAL DEPLOYMENT ──────────────────────────────────────────────── */}
      <Section labelledBy="ws-deployment-title">
        <Panel title="deployments / ld-tennis" meta={<Badge state="success">Real deployment</Badge>}>
          <div className={styles.deployment}>
            <div>
              <p className="bb-eyebrow">Real deployment example</p>
              <h2 id="ws-deployment-title" className={styles.deploymentTitle}>
                LD Tennis
              </h2>
              <p className={styles.bodyText}>
                A real BRΛINBΛSE deployment where the customer-facing website connects into the wider operation.
                Website enquiries flow through to leads, clients, coaching and session operations, and reporting — all
                through the same BRΛINBΛSE platform.
              </p>
              <div className={styles.linkRow}>
                <a
                  href="https://ldtennis.com.au"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.externalLink}
                >
                  <span className={styles.externalLinkLabel}>
                    View LD Tennis{' '}
                    <span className="bb-visually-hidden">(opens in a new tab)</span>
                  </span>
                  <ArrowIcon className={styles.arrow} />
                </a>
                <TextLink href="/client-operations/demo">Explore the deployment</TextLink>
              </div>
            </div>

            <div>
              <p className="bb-eyebrow">Connected deployment</p>
              <ol className={styles.chain}>
                {DEPLOYMENT_CHAIN.map(item => (
                  <li key={item.name} className={styles.chainItem}>
                    <span className={styles.chainName}>{item.name}</span>
                    <span className={styles.chainDetail}>{item.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Panel>
      </Section>

      {/* 08 DEPLOYMENT OPTIONS ─────────────────────────────────────── */}
      <Section labelledBy="ws-options-title">
        <SectionHeading id="ws-options-title" index="08" eyebrow="Deployment options" title="Start where it makes sense.">
          Not every business needs the full BRΛINBΛSE platform on day one. The website can be the foundation and the
          connected system can grow from there.
        </SectionHeading>

        <DeploymentOptions />

        <p className={styles.scopeNote}>
          Project scope and investment depend on the website, integrations and operational requirements involved. Any
          project costs are scoped and quoted before work begins.
        </p>
      </Section>

      {/* 09 HOW IT WORKS ───────────────────────────────────────────── */}
      <Section labelledBy="ws-process-title">
        <SectionHeading id="ws-process-title" index="09" eyebrow="How it works" title="From idea to live system.">
          The work starts with the business requirement rather than forcing your operation into a predetermined
          website template.
        </SectionHeading>

        <ol className={styles.process}>
          {PROCESS.map(step => (
            <li key={step.number} className={styles.processStep}>
              <span className={styles.processNode} aria-hidden="true" />
              <span className={styles.processIndex}>{step.number}</span>
              <h3 className={styles.cellTitle}>{step.title}</h3>
              <p className={styles.cellBody}>{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* MANAGED BY BRΛINBΛSE ─────────────────────────────────────────── */}
      <Section labelledBy="ws-managed-title">
        <div className={styles.managed}>
          <div className={styles.managedIntro}>
            <p className="bb-eyebrow">Managed by BRΛINBΛSE</p>
            <h2 id="ws-managed-title" className={styles.panelHeading}>
              We can stay responsible after launch.
            </h2>
            <p className={styles.bodyText}>
              A website should not become another system your business has to maintain. BRΛINBΛSE can manage the
              technical environment and continue improving the connected system over time.
            </p>
          </div>
          <ul className={styles.managedGrid}>
            {MANAGED.map(item => (
              <li key={item.title} className={styles.managedItem}>
                <h3 className={styles.managedTitle}>{item.title}</h3>
                <p className={styles.cellBody}>{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* PART OF BRΛINBΛSE ────────────────────────────────────────────── */}
      <Section labelledBy="ws-platform-title">
        <div className={styles.platform}>
          <div>
            <p className="bb-eyebrow">Part of BRΛINBΛSE</p>
            <h2 id="ws-platform-title" className={styles.panelHeading}>
              The website can be the starting point.
            </h2>
            <p className={styles.bodyText}>
              BRΛINBΛSE Web Systems can become the customer-facing layer of a broader operational platform —
              connecting enquiries, clients, workflows, dashboards, reporting and HLNΛ intelligence where appropriate.
            </p>
          </div>
          <div className={styles.platformActions}>
            <ButtonLink href="/demo" variant="secondary">
              Explore BRΛINBΛSE
            </ButtonLink>
            <ButtonLink href="/client-operations" variant="secondary" arrow>
              Client Operations
            </ButtonLink>
          </div>
        </div>
      </Section>

      {/* FINAL CTA ──────────────────────────────────────────────────── */}
      <Section labelledBy="ws-cta-title">
        <div className={`${styles.cta} bb-grid-bg`}>
          <p className="bb-eyebrow">Start with the website</p>
          <h2 id="ws-cta-title" className={styles.ctaTitle}>
            Turn your website into part of the operation.
          </h2>
          <p className={styles.ctaBody}>
            Whether you need a better website or want to connect the systems behind it, we can work out the right
            starting point.
          </p>
          <div className={styles.ctaActions}>
            <ButtonLink href="/request-demo">Discuss your website</ButtonLink>
            <ButtonLink href="/demo" variant="secondary">
              Explore BRΛINBΛSE
            </ButtonLink>
          </div>
        </div>
      </Section>

      <PublicFooter />
    </main>
  );
}
