import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import {
  buildHrAiProviderInput,
  HR_AI_SYSTEM_PROMPT,
  type HrAiProviderInput,
} from '@/lib/hr/aiProviderInput';
import type { AiSafeHrContext } from '@/lib/hr/aiSafeContext';

export const HR_AI_MODEL = 'claude-haiku-4-5-20251001';
export const HR_AI_MAX_TOKENS = 700;
export const HR_AI_MAX_RESPONSE_CHARS = 6_000;
const HR_AI_MAX_SERIALIZED_USER_CHARS = 20_000;

type HrAiProviderResponse = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: string; [key: string]: unknown }
  >;
};

export type HrAiProviderClient = {
  messages: {
    create: (input: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
    }) => Promise<HrAiProviderResponse>;
  };
};

function canonicaliseProviderInput(input: HrAiProviderInput): HrAiProviderInput {
  if (input.system !== HR_AI_SYSTEM_PROMPT) {
    throw new Error('Invalid HR AI system prompt.');
  }
  if (typeof input.user !== 'string' || input.user.length > HR_AI_MAX_SERIALIZED_USER_CHARS) {
    throw new Error('Invalid HR AI user payload.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.user);
  } catch {
    throw new Error('Invalid HR AI user payload.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid HR AI user payload.');
  }

  const payload = parsed as Record<string, unknown>;
  if (typeof payload.question !== 'string' || !payload.hr_context || typeof payload.hr_context !== 'object') {
    throw new Error('Invalid HR AI user payload.');
  }

  try {
    return buildHrAiProviderInput({
      question: payload.question,
      context: payload.hr_context as AiSafeHrContext,
    });
  } catch {
    throw new Error('Invalid HR AI user payload.');
  }
}

/**
 * HR-8F — the single-purpose provider adapter for HR AI.
 *
 * The adapter accepts only HR-8E's provider-neutral contract, validates the
 * fixed HR system prompt, parses and re-materialises the user payload through
 * buildHrAiProviderInput() again, and makes one bounded text-only provider
 * request. It intentionally exposes no tools, database access, generic Helena
 * context, raw HR rows, provider response metadata, or provider-side actions.
 */
export async function invokeHrAiProvider(
  input: HrAiProviderInput,
  options: { client?: HrAiProviderClient } = {},
): Promise<{ text: string }> {
  const safeInput = canonicaliseProviderInput(input);
  const client = options.client
    ?? (new Anthropic() as unknown as HrAiProviderClient);

  const response = await client.messages.create({
    model: HR_AI_MODEL,
    max_tokens: HR_AI_MAX_TOKENS,
    system: safeInput.system,
    messages: [{
      role: 'user',
      content: safeInput.user,
    }],
  });

  const text = response.content
    .filter((block): block is { type: 'text'; text: string } =>
      block.type === 'text' && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
    .slice(0, HR_AI_MAX_RESPONSE_CHARS);

  if (!text) throw new Error('HR AI provider returned no text.');

  return { text };
}
