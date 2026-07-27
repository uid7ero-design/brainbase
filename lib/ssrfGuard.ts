import 'server-only';
import { promises as dns } from 'dns';

export type ResolvedAddress = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type DestinationCheck =
  | { blocked: false }
  | { blocked: true; reason: string };

export const defaultResolver: Resolver = (hostname) => dns.lookup(hostname, { all: true });

const CLOUD_METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata']);
const CLOUD_METADATA_ADDRESSES = new Set(['169.254.169.254', 'fd00:ec2::254']);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

function inCidr(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

// Non-public / reserved IPv4 ranges: unspecified, loopback, RFC1918 private,
// CGNAT, link-local (incl. cloud metadata 169.254.169.254), IETF/test ranges,
// multicast, reserved.
const BLOCKED_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isBlockedIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // fail closed on anything unparseable
  return BLOCKED_V4_RANGES.some(([base, bits]) => inCidr(ipInt, base, bits));
}

export function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified

  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);

  const firstGroup = lower.split(':')[0];
  if (/^fe[89ab][0-9a-f]?$/.test(firstGroup)) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{0,2}$/.test(firstGroup)) return true; // unique-local fc00::/7
  if (firstGroup.startsWith('ff')) return true; // multicast ff00::/8

  return false;
}

/**
 * Determines whether a caller-supplied URL is a safe SSRF-proxy destination.
 * Requires an explicit, non-empty hostname allowlist — an empty/absent
 * allowlist fails closed (blocks everything), it never means "allow all".
 * DNS resolution is injectable so tests never perform real network lookups.
 */
export async function checkDestination(
  urlString: string,
  allowedHosts: string[],
  resolver: Resolver = defaultResolver,
): Promise<DestinationCheck> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { blocked: true, reason: 'invalid_url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { blocked: true, reason: 'invalid_scheme' };
  }

  const normalizedAllowlist = allowedHosts.map(h => h.trim().toLowerCase()).filter(Boolean);
  if (normalizedAllowlist.length === 0) {
    return { blocked: true, reason: 'allowlist_empty' };
  }

  const hostname = url.hostname.toLowerCase();

  if (CLOUD_METADATA_HOSTS.has(hostname)) {
    return { blocked: true, reason: 'cloud_metadata_host' };
  }

  const hostAllowed = normalizedAllowlist.some(
    allowed => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
  if (!hostAllowed) {
    return { blocked: true, reason: 'host_not_allowlisted' };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    return { blocked: true, reason: 'dns_resolution_failed' };
  }
  if (!addresses.length) {
    return { blocked: true, reason: 'dns_resolution_failed' };
  }

  for (const { address, family } of addresses) {
    if (CLOUD_METADATA_ADDRESSES.has(address)) {
      return { blocked: true, reason: 'cloud_metadata_address' };
    }
    if (family === 4 && isBlockedIPv4(address)) {
      return { blocked: true, reason: 'blocked_ip_range' };
    }
    if (family === 6 && isBlockedIPv6(address)) {
      return { blocked: true, reason: 'blocked_ip_range' };
    }
  }

  return { blocked: false };
}

export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}
