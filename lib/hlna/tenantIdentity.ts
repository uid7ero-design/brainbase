// Phase C.2B.3 — tenant-aware system-prompt identity/capability block.
//
// Pure, narrowly-scoped, no DB access of its own (the caller resolves
// orgName/enabledCapabilities and passes them in — see app/api/chat/
// route.ts). Extracted specifically so it's easy to reason about and
// test in isolation, without pulling in the rest of the chat route.
//
// Root cause this replaces: app/api/chat/route.ts's SYSTEM prompt began
// "You are Helena — a sophisticated AI assistant for Brainbase, a
// voice-first executive command centre for municipal council operations"
// — unconditional, for every tenant, regardless of what that tenant's
// organisation_modules actually enables. A read-only audit during this
// phase confirmed organisations has no industry/classification column at
// all, and the only real rows in `modules` today are crm/events/organiser
// — there is no reliable signal anywhere in the schema for "this org is
// genuinely a council/waste/fleet operator". Per this phase's brief,
// a missing signal means neutral behaviour, not guessed behaviour — so
// this function is deliberately industry-agnostic and never infers
// anything from the organisation's name.
export type TenantCapability = { key: string; name: string };

export function buildTenantIdentity(
  orgName: string | null | undefined,
  enabledCapabilities: TenantCapability[],
): string {
  let s = "You are Helena, BrainBase's intelligent assistant for this organisation.";

  if (orgName?.trim()) {
    s += `\n\nCurrent organisation: ${orgName.trim()}.`;
  }

  if (enabledCapabilities.length > 0) {
    const list = enabledCapabilities.map(c => `- ${c.name}`).join('\n');
    s += `\n\nEnabled BrainBase capabilities for this organisation:\n${list}\n` +
      `Only reference these when relevant — do not assume access to any other BrainBase module or dataset, ` +
      `and do not recite this list unprompted; mention a capability only when the user asks what you can help ` +
      `with, asks about that capability specifically, or it is otherwise directly useful to the conversation.`;
  } else {
    s += `\n\nNo BrainBase capability modules are currently enabled for this organisation beyond the core assistant. ` +
      `Do not claim access to data or tools this organisation has not enabled.`;
  }

  return s;
}
