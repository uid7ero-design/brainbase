'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { HlnaOrb } from '@/components/brand/HlnaOrb'
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark'
import { PublicFooter } from '@/components/public/PublicFooter'
import { ArrowIcon, ButtonLink, Container } from '@/components/public/primitives'
import { BrainBaseMark } from '@/components/public/brand'
import { StatusDot } from '@/components/ui/semantic'
import { DEMO_QUESTIONS, TABS, matchDemoAnswer, type TabId } from '@/components/public/demo/data'
import {
  AssetsTab,
  CustomersTab,
  DemoBadge,
  FinancialTab,
  OperationsTab,
  OverviewTab,
  ReportingTab,
  WorkforceTab,
} from '@/components/public/demo/tabs'
import publicStyles from '@/components/public/public.module.css'
import styles from '@/components/public/demo/demo.module.css'

// Interactive platform demo. Marketing chrome (hero, framing, CTAs) is fully
// theme-aware on the --bb-* tokens; the workspace below is a simulated
// BrainBase environment and is theme-aware too, except its top bar, which is
// pinned dark (.bb-scope-dark) because it mirrors the real application
// header — which is dark — and carries the dark-surface BrainBaseWordmark.
// Behaviour (tabs, scenario, simulated HLNA answers and timings) is
// unchanged from the previous implementation.

export default function DemoPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [question, setQuestion] = useState(DEMO_QUESTIONS[0].question)
  const [answer, setAnswer] = useState(DEMO_QUESTIONS[0].answer)
  const [thinking, setThinking] = useState(false)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function askHlna(nextQuestion?: string) {
    const q = (nextQuestion ?? question).trim()
    if (!q || thinking) return

    setQuestion(q)
    setThinking(true)

    window.setTimeout(() => {
      setAnswer(matchDemoAnswer(q).answer)
      setThinking(false)
    }, 650)
  }

  // WAI-ARIA tabs: arrow keys / Home / End move between tabs and select them.
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1
    const next =
      event.key === 'ArrowRight'
        ? (index === last ? 0 : index + 1)
        : event.key === 'ArrowLeft'
          ? (index === 0 ? last : index - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    setActiveTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <main className={`bb-public ${publicStyles.page}`}>
      {/* Page context bar — replaces the page's own sticky header, which
          stacked under the site-wide public nav. Same two links. */}
      <Container>
        <div className={styles.contextBar}>
          <Link href="/" className={styles.backLink}>
            <span aria-hidden="true">←</span> Back to BrainBase
          </Link>
          <Link href="/request-demo" className={styles.contextCta}>
            Request a demo
          </Link>
        </div>
      </Container>

      {/* HERO */}
      <section className={`${styles.hero} bb-grid-bg`} aria-labelledby="demo-title">
        <Container className={styles.heroInner}>
          <div className={styles.orbWrap}>
            <HlnaOrb
              size={100}
              state={
                thinking
                  ? 'thinking'
                  : 'idle'
              }
            />
          </div>

          <DemoBadge />

          <h1 id="demo-title" className={styles.heroTitle}>
            See how a <span className={styles.heroAccent}>connected operation</span> works.
          </h1>

          <p className={styles.heroLede}>
            Explore an example BrainBase environment showing how operational information, workflows, dashboards and
            HLNA come together in one platform. Everything below is an example environment using simulated demo data.
          </p>

          <div className={styles.heroActions}>
            <a href="#workspace" className={`${publicStyles.button} ${publicStyles.buttonPrimary}`}>
              Explore the platform
              <span aria-hidden="true">↓</span>
            </a>
            <ButtonLink href="/pricing" variant="secondary">
              View pricing
            </ButtonLink>
          </div>
        </Container>
      </section>

      {/* PLATFORM WORKSPACE */}
      <section id="workspace" className={styles.shell} aria-labelledby="workspace-title">
        <div className={styles.workspace}>
          <div className={`bb-scope-dark ${styles.workspaceTop}`}>
            <div className={styles.workspaceBrand}>
              <BrainBaseWordmark width={118} />
              <span className={styles.workspaceDivider} aria-hidden="true" />
              <div>
                <small>
                  <BrainBaseMark /> Platform
                </small>
                <h2 id="workspace-title">Interactive Platform Demo</h2>
              </div>
            </div>

            <div className={styles.workspaceRight}>
              <DemoBadge />
              <span className={styles.workspaceConnected}>
                <StatusDot state="success" label="HLNA connected" />
              </span>
            </div>
          </div>

          <div className={styles.connectedContext}>
            <strong>Different views. One connected operation.</strong>
            <p>
              Financial, customers, workforce, assets and reporting are not separate products — they are views into the
              same connected environment. A change in one shows up in the others, for example:
            </p>
            <ul className={styles.connectionList}>
              <li>18 requests outside target → Operations risk</li>
              <li>3 uncovered shifts tomorrow → workforce risk</li>
              <li>Fleet Unit 08 maintenance · maintenance costs trending up</li>
            </ul>
          </div>

          <div className={styles.tabs} role="tablist" aria-label="Demo views">
            {TABS.map((tab, index) => {
              const selected = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  ref={el => {
                    tabRefs.current[index] = el
                  }}
                  type="button"
                  role="tab"
                  id={`demo-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls="demo-tabpanel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={event => onTabKeyDown(event, index)}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div className={styles.content}>
            <div id="demo-tabpanel" role="tabpanel" aria-labelledby={`demo-tab-${activeTab}`}>
              {activeTab === 'overview' && (
                <OverviewTab
                  askHlna={q => {
                    setQuestion(q)
                    askHlna(q)
                  }}
                />
              )}
              {activeTab === 'financial' && <FinancialTab />}
              {activeTab === 'operations' && <OperationsTab />}
              {activeTab === 'customers' && <CustomersTab />}
              {activeTab === 'workforce' && <WorkforceTab />}
              {activeTab === 'assets' && <AssetsTab />}
              {activeTab === 'reporting' && <ReportingTab />}
            </div>

            {/* HLNA DOCK */}
            <section className={styles.hlnaDock} aria-labelledby="demo-dock-title">
              <div className={styles.hlnaDockHead}>
                <HlnaOrb
                  size={32}
                  state={
                    thinking
                      ? 'thinking'
                      : 'idle'
                  }
                />
                <div>
                  <div className={styles.hlnaDockLabel}>Intelligence Layer</div>
                  <h3 id="demo-dock-title" className={styles.hlnaDockTitle}>
                    Ask the operation
                  </h3>
                </div>
                <span className={styles.dockReady}>
                  <StatusDot state="success" label="Ready" />
                </span>
              </div>

              <p className={styles.hlnaDockFraming}>
                HLNA helps interpret this connected operation — it does not replace the underlying operational system.
              </p>

              {/* Polite, atomic: the simulated answer is announced once it
                  arrives. The thinking indicator is decorative (the Ask
                  button already reads "Thinking…"). */}
              <div className={styles.hlnaAnswer} role="status" aria-live="polite" aria-atomic="true">
                {thinking ? (
                  <span className={styles.thinking} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  answer
                )}
              </div>

              <div className={styles.hlnaSuggestions}>
                {DEMO_QUESTIONS.map(item => (
                  <button
                    type="button"
                    key={item.question}
                    onClick={() => {
                      setQuestion(item.question)
                      askHlna(item.question)
                    }}
                  >
                    {item.question}
                  </button>
                ))}
              </div>

              <form
                className={styles.hlnaForm}
                onSubmit={event => {
                  event.preventDefault()
                  askHlna()
                }}
              >
                <input
                  value={question}
                  onChange={event => setQuestion(event.target.value)}
                  placeholder="Ask HLNA about operations, costs, customers or risk…"
                  aria-label="Ask HLNA a question"
                />
                <button type="submit" disabled={!question.trim() || thinking}>
                  {thinking ? 'Thinking…' : 'Ask HLNA'}
                </button>
              </form>
            </section>
          </div>
        </div>
      </section>

      {/* CONFIGURABILITY */}
      <Container>
        <div className={styles.configNote}>
          <strong>This is one example configuration.</strong>
          <p>
            Same platform. Different operation. Another organisation could use a different combination of BrainBase
            capabilities, configured around how it works.
          </p>
        </div>
      </Container>

      {/* FINAL CTA */}
      <Container>
        <div className={`${styles.bottomCta} bb-grid-bg`}>
          <DemoBadge />
          <h2 className={styles.bottomCtaTitle}>
            What would BrainBase look like
            <br />
            around your operation?
          </h2>
          <p>
            BrainBase can be configured around how your organisation already works — connecting information, workflows,
            reporting and intelligence without forcing the business into another disconnected tool.
          </p>
          <div className={styles.heroActions}>
            <ButtonLink href="/request-demo">Discuss your operation</ButtonLink>
            <ButtonLink href="/client-operations" variant="secondary">
              Explore Client Operations
            </ButtonLink>
          </div>
          <Link href="/web-systems" className={styles.tertiaryLink}>
            or explore Web Systems
            <ArrowIcon />
          </Link>
        </div>
      </Container>

      <PublicFooter />
    </main>
  )
}
