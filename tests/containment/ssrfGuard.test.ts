import { describe, it, expect } from 'vitest';
import { checkDestination, isBlockedIPv4, isBlockedIPv6, parseAllowedHosts } from '@/lib/ssrfGuard';
import type { Resolver } from '@/lib/ssrfGuard';

function fakeResolver(addresses: { address: string; family: number }[]): Resolver {
  return async () => addresses;
}

describe('ssrfGuard.isBlockedIPv4', () => {
  it('blocks loopback', () => expect(isBlockedIPv4('127.0.0.1')).toBe(true));
  it('blocks RFC1918 10.x', () => expect(isBlockedIPv4('10.1.2.3')).toBe(true));
  it('blocks RFC1918 172.16-31.x', () => expect(isBlockedIPv4('172.20.0.5')).toBe(true));
  it('blocks RFC1918 192.168.x', () => expect(isBlockedIPv4('192.168.1.1')).toBe(true));
  it('blocks link-local / cloud metadata range', () => expect(isBlockedIPv4('169.254.169.254')).toBe(true));
  it('blocks unspecified 0.0.0.0', () => expect(isBlockedIPv4('0.0.0.0')).toBe(true));
  it('blocks multicast', () => expect(isBlockedIPv4('224.0.0.1')).toBe(true));
  it('allows a public address', () => expect(isBlockedIPv4('93.184.216.34')).toBe(false));
});

describe('ssrfGuard.isBlockedIPv6', () => {
  it('blocks ::1 loopback', () => expect(isBlockedIPv6('::1')).toBe(true));
  it('blocks :: unspecified', () => expect(isBlockedIPv6('::')).toBe(true));
  it('blocks link-local fe80::/10', () => expect(isBlockedIPv6('fe80::1')).toBe(true));
  it('blocks unique-local fc00::/7', () => expect(isBlockedIPv6('fd00::1')).toBe(true));
  it('blocks multicast ff00::/8', () => expect(isBlockedIPv6('ff02::1')).toBe(true));
  it('blocks IPv4-mapped private address', () => expect(isBlockedIPv6('::ffff:10.0.0.1')).toBe(true));
  it('allows a public IPv6 address', () => expect(isBlockedIPv6('2606:2800:220:1:248:1893:25c8:1946')).toBe(false));
});

describe('ssrfGuard.checkDestination', () => {
  const allowed = ['example.com'];

  it('rejects an empty/absent allowlist (fail closed)', async () => {
    const result = await checkDestination('https://example.com/metrics', [], fakeResolver([{ address: '93.184.216.34', family: 4 }]));
    expect(result.blocked).toBe(true);
  });

  it('rejects non-http(s) schemes', async () => {
    const result = await checkDestination('file:///etc/passwd', allowed);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toBe('invalid_scheme');
  });

  it('rejects a hostname not on the allowlist', async () => {
    const result = await checkDestination('https://evil.example.org/x', allowed, fakeResolver([{ address: '93.184.216.34', family: 4 }]));
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toBe('host_not_allowlisted');
  });

  it('allows an exact allowlisted hostname resolving to a public address', async () => {
    const result = await checkDestination('https://example.com/metrics', allowed, fakeResolver([{ address: '93.184.216.34', family: 4 }]));
    expect(result.blocked).toBe(false);
  });

  it('allows a safely-matched subdomain of an allowlisted hostname', async () => {
    const result = await checkDestination('https://status.example.com/metrics', allowed, fakeResolver([{ address: '93.184.216.34', family: 4 }]));
    expect(result.blocked).toBe(false);
  });

  it('does not allow a suffix-only match ("evilexample.com" vs "example.com")', async () => {
    const result = await checkDestination('https://evilexample.com/x', allowed, fakeResolver([{ address: '93.184.216.34', family: 4 }]));
    expect(result.blocked).toBe(true);
  });

  it('rejects an allowlisted hostname whose DNS resolves to localhost', async () => {
    const result = await checkDestination('https://example.com/metrics', allowed, fakeResolver([{ address: '127.0.0.1', family: 4 }]));
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toBe('blocked_ip_range');
  });

  it('rejects an allowlisted hostname whose DNS resolves to an RFC1918 address', async () => {
    const result = await checkDestination('https://example.com/metrics', allowed, fakeResolver([{ address: '10.0.0.5', family: 4 }]));
    expect(result.blocked).toBe(true);
  });

  it('rejects an allowlisted hostname whose DNS resolves to a link-local / cloud metadata address', async () => {
    const result = await checkDestination('https://example.com/metrics', allowed, fakeResolver([{ address: '169.254.169.254', family: 4 }]));
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toBe('cloud_metadata_address');
  });

  it('rejects an allowlisted hostname whose DNS resolves to ::1', async () => {
    const result = await checkDestination('https://example.com/metrics', allowed, fakeResolver([{ address: '::1', family: 6 }]));
    expect(result.blocked).toBe(true);
  });

  it('rejects the literal cloud metadata hostname even if allowlisted', async () => {
    const result = await checkDestination('http://metadata.google.internal/computeMetadata', ['metadata.google.internal'], fakeResolver([{ address: '93.184.216.34', family: 4 }]));
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toBe('cloud_metadata_host');
  });

  it('rejects an invalid URL', async () => {
    const result = await checkDestination('not a url', allowed);
    expect(result.blocked).toBe(true);
  });

  it('fails closed when DNS resolution throws', async () => {
    const failingResolver: Resolver = async () => { throw new Error('ENOTFOUND'); };
    const result = await checkDestination('https://example.com/x', allowed, failingResolver);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toBe('dns_resolution_failed');
  });
});

describe('ssrfGuard.parseAllowedHosts', () => {
  it('splits, trims and lowercases a comma-separated list', () => {
    expect(parseAllowedHosts(' Example.com , Status.Example.com ,,')).toEqual(['example.com', 'status.example.com']);
  });
  it('returns an empty array for undefined', () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
  });
});
