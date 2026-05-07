import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

type FounderIntelResponse = {
  summary: string;
  opportunities: string[];
  risks: string[];
  recommended_actions: Array<{ impact?: string; urgency?: string; effort?: string; action: string; detail?: string }>;
  attention_queue: Array<{ id?: number; severity?: string; type?: string; title: string; why?: string; action?: string; due?: string; cta?: string }>;
  system_alerts: string[];
  confidence: number;
  generated_at: string;
};

const MOCK: FounderIntelResponse = {
  summary: 'Portfolio is performing well with MRR up 18% month-over-month. Two high-urgency deals require attention today — Port Adelaide trial is at risk of expiry and the Campbelltown proposal needs finalisation before end of business. System health is stable with one quota warning on ElevenLabs.',
  opportunities: [
    'Trial conversions up 22% this week. Campbelltown proposal is the highest-value open deal at $3,200/mo — closing this week would push ARR past $150k.',
    'Mount Barker is a strong upsell candidate for the fleet module in Q3. Engagement is high and the primary user is an internal champion.',
  ],
  risks: [
    'Port Adelaide trial expires in 2 days with no contact in 5 days — high churn risk if no re-engagement today.',
    'ElevenLabs quota at 94% — voice analysis will fail for all organisations if the limit is exceeded this week.',
    '2 demos unconfirmed with no reply to calendar invites — no-show risk for Mitcham and Tea Tree Gully.',
  ],
  recommended_actions: [
    { impact: 'high', urgency: 'high', effort: 'low',    action: 'Send Port Adelaide a personalised contamination briefing',   detail: 'Norwood at 11.2% — use as re-engagement hook before trial expires.' },
    { impact: 'high', urgency: 'high', effort: 'medium', action: 'Finalise Campbelltown proposal before end of business',        detail: 'Mark Okafor has opened the email 3 times today — intent is high.' },
    { impact: 'med',  urgency: 'med',  effort: 'low',    action: 'Fix City of Unley upload column mapping',                      detail: '"financial_year" rejected. Manual remap takes 5 minutes.' },
    { impact: 'med',  urgency: 'low',  effort: 'medium', action: 'Prepare Mitcham HLNA demo with live waste data walkthrough',   detail: 'Lisa Park wants to see real data in action before committing.' },
  ],
  attention_queue: [
    { id: 1, severity: 'critical', type: 'sales',   title: 'Port Adelaide — no follow-up for 5 days',        why: 'Trial expires in 2 days. No contact since initial demo. High churn risk.',   action: 'Send personalised HLNA waste briefing now',    due: 'Today 5pm',  cta: 'Send Briefing'   },
    { id: 2, severity: 'high',     type: 'sales',   title: 'Campbelltown proposal — highest-value open deal', why: '$3,200/mo at risk. Mark Okafor is expecting a response by end of day.',     action: 'Send revised pricing proposal',                due: 'Today EOD',  cta: 'Create Proposal' },
    { id: 3, severity: 'high',     type: 'system',  title: 'ElevenLabs quota at 94% — voice at risk',        why: 'Voice analysis will fail for all organisations if limit is exceeded.',      action: 'Upgrade plan or reduce voice usage this week', due: 'This week',  cta: 'Review Usage'    },
    { id: 4, severity: 'medium',   type: 'product', title: 'City of Unley — failed upload needs review',     why: '"financial_year" column unmapped. waste_sample.csv rejected at intake.',    action: 'Review and remap columns (5 min fix)',          due: 'Today',      cta: 'Review Upload'   },
    { id: 5, severity: 'medium',   type: 'sales',   title: '2 demos not confirmed — Mitcham & Tea Tree Gully', why: 'No reply to calendar invite. Risk of no-show if not confirmed by tomorrow.', action: 'Send confirmation message to both contacts',  due: 'Tomorrow 9am', cta: 'Confirm Demos' },
  ],
  system_alerts: [],
  confidence: 0.87,
  generated_at: new Date().toISOString(),
};

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'super_admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Attempt to fetch live founder intelligence from the backend.
  if (BACKEND) {
    try {
      const res = await fetch(`${BACKEND}/founder-intelligence`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as FounderIntelResponse;
        return NextResponse.json(data);
      }
      console.warn('[founder-intelligence] backend responded', res.status, '— falling back to mock');
    } catch (err) {
      console.warn('[founder-intelligence] backend unreachable:', (err as Error).message, '— falling back to mock');
    }
  }

  // Backend unavailable or not configured — return mock with a fresh timestamp.
  return NextResponse.json({ ...MOCK, generated_at: new Date().toISOString() });
}
