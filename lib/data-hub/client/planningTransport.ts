// Browser transport only. Descriptions still require the closed exchange decoder.
export const PLANNING_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_PLANNING_RESPONSE_BYTES = 1_048_576;
type FailureCode = "REQUEST_FAILED" | "REQUEST_TIMED_OUT" | "REQUEST_CANCELLED" | "PLANNING_RESPONSE_INVALID";
type Result = { ok: true; text: string; httpOk: boolean } | { ok: false; code: FailureCode };
const denied = (code: FailureCode): Result => ({ ok: false, code });

async function read(response: Response, signal: AbortSignal): Promise<Result> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    return denied("REQUEST_CANCELLED");
  }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) {
    void response.body?.cancel().catch(() => {});
    return denied("PLANNING_RESPONSE_INVALID");
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0; let text = "";
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) return denied("REQUEST_CANCELLED");
      const entry = await reader.read();
      if (entry.done) break;
      size += entry.value.byteLength;
      if (size > MAX_PLANNING_RESPONSE_BYTES) { cancel(); return denied("PLANNING_RESPONSE_INVALID"); }
      text += decoder.decode(entry.value, { stream: true });
    }
    text += decoder.decode();
    return signal.aborted ? denied("REQUEST_CANCELLED") : { ok: true, text, httpOk: response.ok };
  } catch {
    cancel();
    return denied(signal.aborted ? "REQUEST_CANCELLED" : "PLANNING_RESPONSE_INVALID");
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

// The race releases UI locks even if a transport ignores abort. Late work has
// no UI callbacks; the caller additionally checks component/request identity.
export async function fetchPlanningText(url: string, init: RequestInit, controller: AbortController): Promise<Result> {
  if (controller.signal.aborted) return denied("REQUEST_CANCELLED");
  let stop!: (value: Result) => void;
  const stopped = new Promise<Result>(resolve => { stop = resolve; });
  const cancel = () => stop(denied("REQUEST_CANCELLED"));
  controller.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    stop(denied("REQUEST_TIMED_OUT")); controller.abort();
  }, PLANNING_REQUEST_TIMEOUT_MS);
  try {
    const work = (async () => {
      try { return await read(await fetch(url, { ...init, signal: controller.signal }), controller.signal); }
      catch { return denied("REQUEST_FAILED"); }
    })();
    return await Promise.race([work, stopped]);
  } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", cancel); }
}
