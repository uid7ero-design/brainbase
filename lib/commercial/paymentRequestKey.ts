// Store only opaque request identifiers and payload fingerprints for this tab.
// Successful responses clear the pending request; uncertain responses retain it.
export async function paymentRequestKey(scope: string, payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const storageKey = `supplier-payment:v1:${scope}:${fingerprint}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const key = crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  return key;
}
export function clearPaymentRequestKey(scope: string, key: string) {
  for (const name of Object.keys(sessionStorage)) {
    if (name.startsWith(`supplier-payment:v1:${scope}:`) && sessionStorage.getItem(name) === key) sessionStorage.removeItem(name);
  }
}
