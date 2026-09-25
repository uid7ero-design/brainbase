import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import DemoPage from '@/app/demo/page'
import { DEMO_QUESTIONS, TABS } from '@/components/public/demo/data'
import { renderBrainbase } from '../../a11y/render'
import { expectNoAxeViolations } from '../../a11y/axe'
import { expectNotLiveRegion, expectPoliteLiveRegion } from '../../a11y/live-region'

// /demo schedules its simulated answers and scenario steps with
// window.setTimeout, so keyboard interactions run under fake timers.
function setup(theme: 'light' | 'dark' = 'dark') {
  const result = renderBrainbase(<DemoPage />, { theme })
  return result
}

describe('/demo', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    vi.useRealTimers()
    const { container } = setup(theme)
    await expectNoAxeViolations(container)
  })

  it('has one h1 and never skips a heading level', () => {
    const { container } = setup()
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName[1]))
    expect(levels.filter(l => l === 1)).toHaveLength(1)
    expect(levels[0]).toBe(1)
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1)
    })
  })

  it('keeps the hero, framing and CTA copy', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('See how a connected operation works.')
    for (const text of [
      'Different views. One connected operation.',
      'This is one example configuration.',
      'Try it: run an example scenario',
      'HLNΛ helps interpret this connected operation — it does not replace the underlying operational system.',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { level: 2, name: /around your operation\?/ })).toBeInTheDocument()
  })

  it('keeps every destination the previous page linked to', () => {
    const { container } = setup()
    const hrefs = new Set([...container.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))
    for (const href of ['/', '/request-demo', '#workspace', '/pricing', '/client-operations', '/web-systems', '/privacy', '/terms']) {
      expect(hrefs).toContain(href)
    }
  })

  it('renders both functional HLNΛ orbs', () => {
    const { container } = setup()
    expect(container.querySelectorAll('img[src*="hlna-orb"]').length).toBeGreaterThanOrEqual(2)
  })

  it('tabs follow the WAI-ARIA pattern and switch views from the keyboard', async () => {
    const { user } = setup()
    const tablist = screen.getByRole('tablist', { name: 'Demo views' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(TABS.map(t => t.label))
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs.filter(t => t.getAttribute('tabindex') === '0')).toHaveLength(1)

    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveFocus()
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Financial')
    expect(screen.getByRole('heading', { name: 'Understand where money is moving.' })).toBeInTheDocument()

    await user.keyboard('{End}')
    expect(tabs[TABS.length - 1]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Turn operational data into decisions.' })).toBeInTheDocument()

    await user.keyboard('{Home}')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(tabs[TABS.length - 1]).toHaveFocus()
  })

  it('the example scenario runs with Enter and announces only its start and finish', async () => {
    const { user } = setup()
    const button = screen.getByRole('button', { name: 'Run scenario' })
    const announcer = screen.getAllByRole('status').find(el => el.classList.contains('bb-visually-hidden'))!
    expectPoliteLiveRegion(announcer)
    expect(announcer).toHaveTextContent('')

    button.focus()
    await user.keyboard('{Enter}')
    expect(announcer).toHaveTextContent('Scenario started')
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled()

    await act(async () => {
      vi.advanceTimersByTime(2200)
    })
    expect(announcer).toHaveTextContent('Scenario complete')
    expect(screen.getByText('Open Requests').closest('div')!.parentElement).toHaveTextContent('49')
    const log = screen.getByText('New service request logged — REQ-1053')
    expectNotLiveRegion(log)

    await user.click(screen.getByRole('button', { name: 'Reset scenario' }))
    expect(announcer).toHaveTextContent('')
    expect(screen.queryByText('New service request logged — REQ-1053')).toBeNull()
  })

  it('asks HLNΛ from the keyboard and announces the answer politely', async () => {
    const { user } = setup()
    const input = screen.getByRole('textbox', { name: 'Ask HLNΛ a question' })
    const answerRegion = screen.getByText(DEMO_QUESTIONS[0].answer)
    expectPoliteLiveRegion(answerRegion)

    await user.clear(input)
    await user.type(input, 'where are costs rising{Enter}')
    expect(screen.getByRole('button', { name: 'Thinking…' })).toBeDisabled()

    await act(async () => {
      vi.advanceTimersByTime(700)
    })
    expect(answerRegion).toHaveTextContent(DEMO_QUESTIONS[1].answer)
    expect(screen.getByRole('button', { name: 'Ask HLNΛ' })).toBeEnabled()
  })

  it('suggestion buttons work with Space', async () => {
    const { user } = setup()
    const dock = screen.getByRole('region', { name: 'Ask the operation' })
    const suggestion = within(dock).getByRole('button', { name: DEMO_QUESTIONS[3].question })
    suggestion.focus()
    await user.keyboard(' ')
    await act(async () => {
      vi.advanceTimersByTime(700)
    })
    expect(within(dock).getByText(DEMO_QUESTIONS[3].answer)).toBeInTheDocument()
  })

  it('status indicators name their state in text, not colour alone', () => {
    setup()
    const status = screen.getByRole('list', { name: 'System status' })
    for (const word of ['Attention', 'Stable', 'Operational', 'Watch', 'Elevated']) {
      expect(within(status).getAllByText(word).length).toBeGreaterThan(0)
    }
  })

  it('duplicate "Preview" buttons have distinct accessible names', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('tab', { name: 'Reporting' }))
    for (const title of ['Executive Summary', 'Monthly Performance', 'Exception Report', 'HLNΛ Analysis']) {
      expect(screen.getByRole('button', { name: `Preview ${title}` })).toBeInTheDocument()
    }
  })
})
