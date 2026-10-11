export const PROFILE_COUNT_BUNDLE_VERSION = "v1" as const;
export const MAX_PROFILE_COUNT_BUNDLE_REQUESTS = 20;

export interface ProfileCountBundleInput {
  bundleVersion: typeof PROFILE_COUNT_BUNDLE_VERSION;
  expectedReviewRevision: number;
  // List membership is detached; individual intents remain unknown until the
  // governed request planner validates them. This grants no execution rights.
  requests: readonly unknown[];
}
export type ValidateProfileCountBundleInputResult =
  | { ok: true; bundle: ProfileCountBundleInput }
  | { ok: false; code: "PROFILE_BUNDLE_INVALID" };

export function validateProfileCountBundleInput(input: unknown): ValidateProfileCountBundleInputResult {
  const invalid = { ok: false, code: "PROFILE_BUNDLE_INVALID" } as const;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid;
  const keys = Reflect.ownKeys(input);
  const names = ["bundleVersion", "expectedReviewRevision", "requests"] as const;
  if (keys.length !== names.length || !names.every(name => keys.includes(name))) return invalid;
  // Envelopes are data, not executable property access. Do not invoke getters
  // while admitting an internal unknown value; inherited metadata is invalid.
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (!names.every(name => "value" in descriptors[name] && descriptors[name].enumerable)) return invalid;
  const version = descriptors.bundleVersion.value;
  const revision = descriptors.expectedReviewRevision.value;
  const source = descriptors.requests.value;
  if (version !== PROFILE_COUNT_BUNDLE_VERSION || !Number.isSafeInteger(revision) || revision < 1 ||
      !Array.isArray(source) || source.length < 1 || source.length > MAX_PROFILE_COUNT_BUNDLE_REQUESTS) return invalid;
  const length = source.length;
  const requests: unknown[] = [];
  // Index descriptors avoid custom iterators and inherited/accessor entries.
  // Holes remain undefined so the planner retains its indexed INVALID_REQUEST.
  for (let index = 0; index < length; index++) {
    const entry = Object.getOwnPropertyDescriptor(source, index);
    if (entry && !("value" in entry)) return invalid;
    requests.push(entry?.value);
  }
  return { ok: true, bundle: { bundleVersion: PROFILE_COUNT_BUNDLE_VERSION,
    expectedReviewRevision: revision, requests } };
}
