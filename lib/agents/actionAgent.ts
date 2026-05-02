import Anthropic from '@anthropic-ai/sdk';
import type { AgentInput, AgentOutput, Evidence } from './types';

const anthropic = new Anthropic();

const SYSTEM = `You are an operations advisor for a municipal council.

You receive a list of operational findings (anomalies, trends, risks) from data analysis.
Your job is to convert each finding into a concrete, prioritised action card.

Score each action on:
- impact (1–10): operational or financial significance if unaddressed
- urgency (1–10): how soon action is needed (10 = immediate, 1 = can wait months)
- effort (1–10): difficulty to execute (1 = quick fix, 10 = major programme)

Priority score = (impact × urgency) / effort — higher is more urgent.

RULES:
- Actions must be specific and name the entity from the finding (suburb, vehicle ID, service type).
- Do not invent findings not in the input data.
- Keep action titles under 12 words.
- Owner should be a council role: Operations Manager, Fleet Coordinator, Customer Service Lead, etc.

Return valid JSON only:
{
  "actions": [
    {
      "title": "Action title — concise, specific",
      "description": "What to do and why. 2 sentences max.",
      "impact": 1-10,
      "urgency": 1-10,
      "effort": 1-10,
      "priority": <computed>,
      "owner": "Role responsible",
      "deadline": "immediate|this_week|this_month|next_quarter"
    }
  ],
  "summary": "One sentence: the top-priority action and why it leads the list.",
  "confidence": 0.0-1.0,
  "evidenceSummary": "Which findings drove the top actions. Name the specific entities (suburbs, vehicles, service types).",
  "calculationUsed": "Priority = (impact × urgency) / effort. State the top 3 scores and what drove each rating.",
  "confidenceReason": "Why this confidence level: quality, specificity, and completeness of the input findings."
}

Sort actions by priority descending. Return 3–8 actions.`;

export async function run(input: AgentInput): Promise<AgentOutput> {
  // dataContext can be a prior AgentOutput (from InsightAgent) or raw findings array
  const ctx = input.dataContext as { findings?: string[]; summary?: string } | string[] | undefined;

  let findingsText: string;
  if (Array.isArray(ctx)) {
    findingsText = ctx.join('\n');
  } else if (ctx?.findings?.length) {
    findingsText = `Summary: ${ctx.summary ?? ''}\n\nFindings:\n${ctx.findings.join('\n')}`;
  } else if (input.query) {
    findingsText = input.query;
  } else {
    return {
      agentName: 'ActionAgent',
      summary: 'No findings provided to generate actions from.',
      findings: [],
      confidence: 0,
      recommendedActions: ['Run InsightAgent first, then pass its output as dataContext.'],
      sourceRows: [],
      warnings: ['dataContext is empty.'],
    };
  }

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Convert these operational findings into prioritised action cards.\n\n${findingsText}`,
      }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]) as {
      actions: Array<{
        title: string;
        description: string;
        impact: number;
        urgency: number;
        effort: number;
        priority: number;
        owner: string;
        deadline: string;
      }>;
      summary: string;
      confidence: number;
      evidenceSummary?: string;
      calculationUsed?: string;
      confidenceReason?: string;
    };

    const findings = (parsed.actions ?? []).map(a =>
      `[${a.deadline.toUpperCase()}] ${a.title} — Priority ${a.priority.toFixed(1)} (${a.owner})`,
    );

    const actions = (parsed.actions ?? []).map(a =>
      `${a.title}: ${a.description}`,
    );

    const evidence: Evidence = {
      sourceDataset:   ['insight_findings'],
      sourceColumns:   ['title', 'description', 'impact', 'urgency', 'effort', 'priority', 'owner', 'deadline'],
      evidenceSummary: parsed.evidenceSummary ?? `${parsed.actions?.length ?? 0} actions derived from operational findings.`,
      calculationUsed: parsed.calculationUsed ?? 'Priority = (impact × urgency) / effort. Sorted descending.',
      confidenceReason: parsed.confidenceReason ?? `Confidence based on specificity of input findings.`,
      sampleRows: (parsed.actions ?? []).slice(0, 3),
    };

    return {
      agentName: 'ActionAgent',
      summary: parsed.summary,
      findings,
      confidence: parsed.confidence ?? 0.7,
      recommendedActions: actions,
      sourceRows: parsed.actions ?? [],
      warnings: [],
      evidence,
    };
  } catch (err) {
    return {
      agentName: 'ActionAgent',
      summary: 'Action generation failed.',
      findings: [],
      confidence: 0,
      recommendedActions: [],
      sourceRows: [],
      warnings: [`Error: ${(err as Error).message}`],
    };
  }
}
