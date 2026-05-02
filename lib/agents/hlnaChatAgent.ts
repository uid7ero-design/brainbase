import Anthropic from '@anthropic-ai/sdk';
import type { AgentInput, AgentOutput } from './types';

const anthropic = new Anthropic();

const SYSTEM = `You are Helena — a municipal council operations AI assistant.

You have access to organisation-scoped operational data. Answer questions about waste, fleet, and service request operations clearly and directly.

RULES:
- Only reference data from this organisation. Never invent figures.
- If you do not have data to answer a specific question, say so and suggest what data would help.
- Use plain English. No markdown formatting in your response text.
- Cite specific entities (suburb names, vehicle IDs, service types) when available.
- Adapt confidence language to available data:
  - High confidence: direct statements ("costs are up 14%")
  - Medium confidence: hedged statements ("costs appear to be up around 14%")
  - Low confidence: cautious statements ("with limited data, costs may be trending up")

Return valid JSON only:
{
  "response": "Plain English response to speak aloud. No markdown.",
  "findings": ["Key fact stated in the response, cited from data."],
  "confidence": 0.0-1.0,
  "warnings": ["Any gaps in available data."]
}`;

export async function run(input: AgentInput): Promise<AgentOutput> {
  if (!input.query?.trim()) {
    return {
      agentName: 'HLNAChatAgent',
      summary: 'No query provided.',
      findings: [],
      confidence: 0,
      recommendedActions: [],
      sourceRows: [],
      warnings: ['Query is required.'],
    };
  }

  const contextNote = input.department
    ? `\n[Active department: ${input.department}]`
    : '';

  const dataCtx = input.dataContext
    ? `\n[Additional context]\n${JSON.stringify(input.dataContext)}`
    : '';

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM + contextNote, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Organisation ID: ${input.organisationId}${dataCtx}\n\nQuestion: ${input.query}`,
      }],
    });

    const textBlock = resp.content.find(b => b.type === 'text');
    const raw = textBlock?.type === 'text' ? textBlock.text : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        agentName: 'HLNAChatAgent',
        summary: raw.trim().slice(0, 300),
        findings: [],
        confidence: 0.5,
        recommendedActions: [],
        sourceRows: [],
        warnings: [],
      };
    }

    const parsed = JSON.parse(match[0]) as {
      response: string;
      findings: string[];
      confidence: number;
      warnings: string[];
    };

    return {
      agentName: 'HLNAChatAgent',
      summary: parsed.response,
      findings: parsed.findings ?? [],
      confidence: parsed.confidence ?? 0.5,
      recommendedActions: [],
      sourceRows: [],
      warnings: parsed.warnings ?? [],
    };
  } catch (err) {
    return {
      agentName: 'HLNAChatAgent',
      summary: "I'm having trouble right now. Please try again.",
      findings: [],
      confidence: 0,
      recommendedActions: [],
      sourceRows: [],
      warnings: [`Error: ${(err as Error).message}`],
    };
  }
}
