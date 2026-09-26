import Link from 'next/link';

import CommandDemo from '@/components/CommandDemo';
import { PublicFooter } from '@/components/public/PublicFooter';
import { ScrollToTopOnLoad } from '@/components/public/ScrollToTopOnLoad';
import { SystemMap } from '@/components/public/SystemMap';
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
  CAPABILITIES,
  CONFIG_EXAMPLES,
  HOW_STEPS,
  INTEGRATION_CAPABILITIES,
  INTELLIGENCE,
  PROBLEM_TOOLS,
  PROOF_FLOW,
  PROOF_POINTS,
  SOLUTION_OUTCOMES,
  STARTING_POINTS,
  STAT_STRIP,
} from '@/components/public/home/content';
import { Badge } from '@/components/ui/semantic';
import { HlnaMark } from '@/components/public/brand';
import publicStyles from '@/components/public/public.module.css';
import styles from '@/components/public/home/home.module.css';

// Public homepage. Server component: all copy and structure render as HTML;
// the only client islands are CommandDemo (the interactive HLNA query box),
// the nav's theme toggle/mobile menu, and the load-time scroll reset.
// Every colour is a --bb-* token, so the page renders in light and dark.

export default function Home() {
  return (
    <main className={`bb-public ${publicStyles.page}`}>
      <ScrollToTopOnLoad />

      {/* 1. HERO ─────────────────────────────────────────────────────── */}
      <section className={`${styles.hero} bb-grid-bg`} aria-labelledby="home-title">
        <Container className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={`bb-eyebrow ${styles.heroEyebrow}`}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              Connected operational platform
            </p>

            <h1 id="home-title" className={styles.heroTitle}>
              One platform.
              <br />
              <span className={styles.heroAccent}>Built around how</span>
              <br />
              your business works.
            </h1>

            <p className={styles.heroLede}>
              BrainBase brings the parts of your operation that matter into one connected environment. Start with the
              capabilities you need, configure them around your workflow and connect the systems you already use.
            </p>

            <div className={styles.heroActions}>
              <ButtonLink href="/demo">Explore BrainBase</ButtonLink>
              <ButtonLink href="/request-demo" variant="secondary">
                Discuss your operation
              </ButtonLink>
            </div>

            <ul className={styles.proofPoints}>
              {PROOF_POINTS.map(point => (
                <li key={point}>{point}</li>
              ))}
            </ul>

            <p className={styles.hlnaMeta}>
              <span className="bb-eyebrow">Intelligence layer</span>
              <HlnaMark className={styles.hlnaMark} />
            </p>
          </div>

          <div className={styles.heroVisual}>
            <Panel
              as="figure"
              title="brainbase / platform map"
              className={styles.mapPanel}
              bodyClassName={`${styles.mapBody} bb-grid-bg`}
            >
              <SystemMap />
            </Panel>

            <div className={styles.terminal}>
              <Panel
                title={
                  <>
                    <HlnaMark /> · Operational intelligence
                  </>
                }
                bodyClassName={`bb-scope-dark ${styles.terminalBody}`}
              >
                <CommandDemo placeholder="Ask BrainBase what's happening across your operation..." />
              </Panel>
            </div>
          </div>
        </Container>
      </section>

      {/* Stat strip ─────────────────────────────────────────────────── */}
      <Container>
        <dl className={styles.statStrip}>
          {STAT_STRIP.map(([value, label]) => (
            <div key={value} className={styles.stat}>
              <dt className={styles.statValue}>{value}</dt>
              <dd className={styles.statLabel}>{label}</dd>
            </div>
          ))}
        </dl>
      </Container>

      {/* 2. THE PROBLEM ──────────────────────────────────────────────── */}
      <Section labelledBy="problem-title">
        <div className={styles.split}>
          <SectionHeading id="problem-title" index="01" eyebrow="The problem" title="Your business shouldn't need ten disconnected systems to get work done.">
            Most businesses build up a mix of tools like these — usually without planning to. None of them are wrong on
            their own, but information gets copied between systems, follow-up gets missed and reporting turns into
            manual work instead of a clear picture.
          </SectionHeading>

          <div className={styles.problemVisual}>
            <ul className={styles.toolScatter} aria-label="Typical disconnected tools">
              {PROBLEM_TOOLS.map(tool => (
                <li key={tool}>
                  <Chip tone="ghost">{tool}</Chip>
                </li>
              ))}
            </ul>
            <p className={styles.pullQuote}>
              Most businesses don&apos;t have a software problem.
              <br />
              They have a <span className={styles.accentText}>connection</span> problem.
            </p>
          </div>
        </div>
      </Section>

      {/* 3. THE APPROACH ─────────────────────────────────────────────── */}
      <Section labelledBy="approach-title">
        <SectionHeading
          id="approach-title"
          index="02"
          eyebrow="The BrainBase approach"
          title="One connected place to run the parts of your business that matter."
        >
          BrainBase brings the information, workflows and operational context you rely on into one connected
          environment.
        </SectionHeading>

        <ul className={`bb-cells ${styles.ruledGrid4}`}>
          {SOLUTION_OUTCOMES.map((item, i) => (
            <li key={item.title}>
              <span className={styles.cellIndex} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className={styles.cellTitle}>{item.title}</h3>
              <p className={styles.cellBody}>{item.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 4. START WITH WHAT YOU NEED ────────────────────────────────── */}
      <Section labelledBy="start-title">
        <SectionHeading id="start-title" index="03" eyebrow="Start with what you need" title="You don't need the whole platform.">
          Here&apos;s what that looks like in practice.
        </SectionHeading>

        <ol className={styles.growthPath}>
          <li className={styles.growthStep}>
            <p className="bb-eyebrow">Today</p>
            <div className={styles.chipRow}>
              <Chip tone="accent">CRM</Chip>
              <Chip tone="accent">Bookings</Chip>
            </div>
          </li>
          <li className={styles.growthStep}>
            <p className="bb-eyebrow">As you grow</p>
            <div className={styles.chipRow}>
              <Chip tone="ghost">Add another capability</Chip>
            </div>
            <p className={styles.note}>
              Shows how the platform is designed to expand — not a specific capability available today.
            </p>
          </li>
          <li className={styles.growthStep}>
            <p className="bb-eyebrow">Connected</p>
            <div className={styles.chipRow}>
              <Chip tone="signal">Microsoft 365</Chip>
            </div>
            <p className={styles.note}>An external system connected to BrainBase — not a BrainBase capability itself.</p>
          </li>
        </ol>
      </Section>

      {/* 5. CAPABILITIES (#product — linked from the public nav) ──────── */}
      <Section id="product" labelledBy="capabilities-title">
        <SectionHeading id="capabilities-title" index="04" eyebrow="Capabilities" title="One place to run the work that matters.">
          Start with the capabilities you need today. Add more as your operation grows.
        </SectionHeading>

        <ul className={`bb-cells ${styles.capabilityGrid}`}>
          {CAPABILITIES.map(capability => (
            <li key={capability.title} className={styles.capability}>
              <span className={styles.capabilityIcon}>{capability.icon}</span>
              <h3 className={styles.cellTitle}>{capability.title}</h3>
              <p className={styles.cellBody}>{capability.description}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 6. CONFIGURABILITY ──────────────────────────────────────────── */}
      <Section labelledBy="config-title">
        <SectionHeading id="config-title" index="05" eyebrow="Configurability" title="Configured around how you work.">
          Two businesses can use the same BrainBase capability very differently — Bookings, for example.
        </SectionHeading>

        <div className={styles.twoCol}>
          {CONFIG_EXAMPLES.map(example => (
            <Panel key={example.title} title="Bookings capability">
              <h3 className={styles.panelHeading}>{example.title}</h3>
              <div className={styles.chipRow}>
                {example.items.map(item => (
                  <Chip key={item}>{item}</Chip>
                ))}
              </div>
            </Panel>
          ))}
        </div>
        <p className={styles.caption}>Same capability. Different operation.</p>
      </Section>

      {/* 7. INTEGRATIONS ─────────────────────────────────────────────── */}
      <Section labelledBy="integrations-title">
        <SectionHeading id="integrations-title" index="06" eyebrow="Integrations" title="Keep the systems that already make sense.">
          BrainBase doesn&apos;t need to replace every specialist system your business relies on. It can connect with
          external systems where it makes sense, keeping important information closer to the operation.
        </SectionHeading>

        <div className={styles.integration}>
          <Panel title="BrainBase capabilities">
            <div className={styles.chipRow}>
              {INTEGRATION_CAPABILITIES.map(item => (
                <Chip key={item} tone="accent">
                  {item}
                </Chip>
              ))}
            </div>
          </Panel>
          <div className={styles.connector} aria-hidden="true">
            <span />
          </div>
          <Panel title="Connected external systems">
            <div className={styles.chipRow}>
              <Chip tone="signal">Microsoft 365</Chip>
            </div>
            <p className={styles.note}>
              Shown as an example of a connected external system — not every integration is available for every system.
            </p>
          </Panel>
        </div>
      </Section>

      {/* 8. HOW IT WORKS ─────────────────────────────────────────────── */}
      <Section labelledBy="how-title">
        <SectionHeading id="how-title" index="07" eyebrow="How BrainBase works" title="Capture. Organise. Operate. Understand.">
          BrainBase turns the information you already have into decisions your people can act on.
        </SectionHeading>

        <ol className={styles.pipeline}>
          {HOW_STEPS.map(step => (
            <li key={step.n} className={styles.pipelineStep}>
              <span className={styles.pipelineNode} aria-hidden="true" />
              <span className={styles.pipelineIndex}>{step.n}</span>
              <h3 className={styles.cellTitle}>{step.title}</h3>
              <p className={styles.cellBody}>{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* 9. HLNA ─────────────────────────────────────────────────────── */}
      <Section labelledBy="hlna-title">
        <div className={styles.hlnaGrid}>
          <div>
            <p className={`bb-eyebrow ${styles.eyebrowInline}`}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              Inside BrainBase
            </p>
            <h2 id="hlna-title" className={styles.hlnaTitle}>
              HLNA — intelligence across your operation.
            </h2>
            <p className={styles.bodyText}>
              When your clients, workflows, scheduling, activity and operational data are connected, HLNA can help
              surface what is happening, what has changed and what may need attention.
            </p>
            <TextLink href="/demo">See HLNA in the platform demo</TextLink>
          </div>

          <ul className={`bb-cells ${styles.intelList}`}>
            {INTELLIGENCE.map(item => (
              <li key={item.title} className={styles.intelItem}>
                <h3 className={styles.cellTitle}>{item.title}</h3>
                <p className={styles.cellBody}>{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* 10. REAL DEPLOYMENT ─────────────────────────────────────────── */}
      <Section labelledBy="deployment-title">
        <Panel title="deployments / ld-tennis" meta={<Badge state="success">Real deployment</Badge>}>
          <div className={styles.deployment}>
            <div>
              <p className="bb-eyebrow">Real deployment example</p>
              <h2 id="deployment-title" className={styles.deploymentTitle}>
                LD Tennis
              </h2>
              <p className={styles.bodyText}>
                A real BrainBase deployment, configured around how LD Tennis operates. Leads, clients, bookings,
                follow-up and reporting work together through the same connected platform.
              </p>
              <TextLink href="/client-operations/demo">Explore the deployment</TextLink>
            </div>

            <ol className={styles.flowPath} aria-label="How information flows through the deployment">
              {PROOF_FLOW.map(([from, to]) => (
                <li key={from} className={styles.flowItem}>
                  <span>{from}</span>
                  <ArrowIcon className={styles.flowArrow} />
                  <span className={styles.flowTo}>{to}</span>
                </li>
              ))}
            </ol>
          </div>
        </Panel>
      </Section>

      {/* 11. STARTING POINTS ─────────────────────────────────────────── */}
      <Section labelledBy="starting-title">
        <SectionHeading id="starting-title" index="08" eyebrow="Starting points" title="More than one way to start with BrainBase.">
          Start with whichever part of the operation needs attention first. Each is a way into the same connected
          platform, not a separate product.
        </SectionHeading>

        <ul className={`bb-cells ${styles.pathGrid}`}>
          {STARTING_POINTS.map(path => (
            <li key={path.href}>
              <Link href={path.href} className={styles.pathCard}>
                <span className={styles.pathMeta}>
                  <span className="bb-eyebrow">{path.eyebrow}</span>
                  <span className={styles.pathNumber} aria-hidden="true">
                    {path.number}
                  </span>
                </span>
                <h3 className={styles.pathTitle}>{path.title}</h3>
                <span className={styles.cellBody}>{path.body}</span>
                <span className={styles.pathAction}>
                  {path.action}
                  <ArrowIcon className={styles.pathArrow} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {/* 12. FINAL CTA ───────────────────────────────────────────────── */}
      <Section labelledBy="cta-title">
        <div className={`${styles.cta} bb-grid-bg`}>
          <p className="bb-eyebrow">Your operation</p>
          <h2 id="cta-title" className={styles.ctaTitle}>
            Tell us what you&apos;re trying to improve.
          </h2>
          <p className={styles.ctaBody}>
            Tell us what is creating friction in your operation and we can explore where BrainBase could fit.
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
