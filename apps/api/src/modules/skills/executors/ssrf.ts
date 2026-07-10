import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * SSRF guard for the real `http.request` executor. Blocks requests to loopback,
 * private, link-local (incl. the 169.254.169.254 cloud-metadata endpoint) and
 * other non-public address ranges — for both IP literals AND hostnames (every
 * resolved address is checked, defending against DNS-rebinding to an internal
 * IP). Set `HTTP_SKILL_ALLOW_PRIVATE=true` to bypass (local dev only).
 */

/** CIDR ranges that must never be reachable from a tenant tool. */
const BLOCKED_V4_CIDRS = [
  '0.0.0.0/8', // "this" network
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local (incl. 169.254.169.254 metadata)
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
] as const;

function ipv4ToLong(ip: string): number {
  const parts = ip.split('.').map((n) => Number(n));
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    parts[3]
  );
}

function inCidrV4(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(range) & mask);
}

function isBlockedV4(ip: string): boolean {
  if (ip === '255.255.255.255') {
    return true;
  }
  return BLOCKED_V4_CIDRS.some((cidr) => inCidrV4(ip, cidr));
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') {
    return true; // loopback / unspecified
  }
  // IPv4-mapped (::ffff:a.b.c.d) → validate the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    return isBlockedV4(mapped[1]);
  }
  const firstHextet = lower.split(':')[0];
  // fc00::/7 unique-local (fc.. / fd..) and fe80::/10 link-local (fe8.. – feb..).
  if (firstHextet.startsWith('fc') || firstHextet.startsWith('fd')) {
    return true;
  }
  return /^fe[89ab]/.test(firstHextet);
}

/** True when `ip` (a literal) falls in a blocked range; unknown → blocked. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isBlockedV4(ip);
  }
  if (family === 6) {
    return isBlockedV6(ip);
  }
  return true; // not a parseable IP → refuse
}

/**
 * Validate an outbound URL. Throws a clear Error when the scheme is not http(s)
 * or the target resolves to a blocked address (unless `allowPrivate`). Returns
 * the parsed URL on success.
 */
export async function assertUrlAllowed(
  rawUrl: string,
  allowPrivate: boolean,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${url.protocol}`);
  }
  if (allowPrivate) {
    return url;
  }
  // Strip brackets from IPv6 literal hosts (e.g. [::1]).
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Blocked host: localhost');
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error(`Blocked private/loopback address: ${host}`);
    }
    return url;
  }
  const resolved = await lookup(host, { all: true });
  for (const entry of resolved) {
    if (isBlockedAddress(entry.address)) {
      throw new Error(`Blocked host resolving to a private address: ${host}`);
    }
  }
  return url;
}
