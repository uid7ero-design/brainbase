export const MAX_PREPARATION_RESPONSE_BYTES = 1_048_576;

// Caller owns its deadline. Abort releases it even when fetch ignores abort.
export async function preparationJson(url: string, method: "GET" | "POST", signal: AbortSignal, body?: unknown) {
  if (signal.aborted) throw new Error("REQUEST_CANCELLED");
  let stop!: (reason: Error) => void;
  const stopped = new Promise<never>((_, reject) => { stop = reject; });
  const cancel = () => stop(new Error("REQUEST_CANCELLED"));
  signal.addEventListener("abort", cancel, { once: true });
  const work = async () => {
    const response = await fetch(url, { method, signal, cache: "no-store", credentials: "same-origin",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    if ([401, 403, 404].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      throw new Error(response.status === 401 ? "UNAUTHORIZED" : response.status === 403 ? "FORBIDDEN" : "UPLOAD_NOT_FOUND");
    }
    if (signal.aborted || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw new Error("RESPONSE_INVALID");
    }
    const reader = response.body.getReader();
    const abortReader = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abortReader, { once: true });
    let bytes = 0, text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (;;) {
        if (signal.aborted) throw new Error("REQUEST_CANCELLED");
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_PREPARATION_RESPONSE_BYTES) throw new Error("RESPONSE_INVALID");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      if (signal.aborted) throw new Error("REQUEST_CANCELLED");
      return { response, body: JSON.parse(text) as unknown };
    } catch {
      abortReader();
      throw new Error(signal.aborted ? "REQUEST_CANCELLED" : "RESPONSE_INVALID");
    } finally { signal.removeEventListener("abort", abortReader); reader.releaseLock(); }
  };
  try { return await Promise.race([work(), stopped]); }
  finally { signal.removeEventListener("abort", cancel); }
}
