import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // unspecified and current network
  [0x0a000000, 0x0affffff], // private
  [0x64400000, 0x647fffff], // shared address space
  [0x7f000000, 0x7fffffff], // loopback
  [0xa9fe0000, 0xa9feffff], // link-local
  [0xac100000, 0xac1fffff], // private
  [0xc0000000, 0xc00000ff], // protocol assignments
  [0xc0000200, 0xc00002ff], // documentation
  [0xc0a80000, 0xc0a8ffff], // private
  [0xc6120000, 0xc613ffff], // benchmark testing
  [0xc6336400, 0xc63364ff], // documentation
  [0xcb007100, 0xcb0071ff], // documentation
  [0xe0000000, 0xffffffff], // multicast and reserved
];

function ipv4Number(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }

  return (((octets[0] << 24) >>> 0) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function ipv4String(value: number): string {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

function ipv6BigInt(address: string): bigint | undefined {
  let normalized = address.toLowerCase().split('%')[0];

  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':');
    const embedded = ipv4Number(normalized.slice(separator + 1));
    if (separator < 0 || embedded === undefined) return undefined;
    const high = ((embedded >>> 16) & 0xffff).toString(16);
    const low = (embedded & 0xffff).toString(16);
    normalized = `${normalized.slice(0, separator)}:${high}:${low}`;
  }

  const sections = normalized.split('::');
  if (sections.length > 2) return undefined;
  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  const present = left.length + right.length;
  if (present > 8 || (sections.length === 1 && present !== 8)) return undefined;

  const parts = sections.length === 2
    ? [...left, ...Array.from({ length: 8 - present }, () => '0'), ...right]
    : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;

  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function isBlockedAddress(address: string): boolean {
  const v4 = ipv4Number(address);
  if (v4 !== undefined) {
    return BLOCKED_IPV4_RANGES.some(([start, end]) => v4 >= start && v4 <= end);
  }

  const v6 = ipv6BigInt(address);
  if (v6 === undefined) return false;
  if (v6 === 0n || v6 === 1n) return true;

  if ((v6 >> 32n) === 0xffffn) {
    return isBlockedAddress(ipv4String(Number(v6 & 0xffffffffn) >>> 0));
  }

  const topSevenBits = v6 >> 121n;
  const topEightBits = v6 >> 120n;
  const topTenBits = v6 >> 118n;
  return topSevenBits === 0x7en || topSevenBits === 0x7fn || topTenBits === 0x3fan || topEightBits === 0xffn;
}

function isAllowedLocalAddress(address: string): boolean {
  const v4 = ipv4Number(address);
  if (v4 !== undefined) return v4 >= 0x7f000000 && v4 <= 0x7fffffff;

  const v6 = ipv6BigInt(address);
  return v6 === 0n || v6 === 1n;
}

function isExplicitlyLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === 'host.docker.internal'
    || hostname === 'metadata.google.internal'
    || hostname.endsWith('.local');
}

export interface SafeHttpUrlOptions {
  allowLocal?: boolean;
  requireResolution?: boolean;
}

export async function assertSafeHttpUrl(
  value: string,
  options: SafeHttpUrlOptions = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('URL is invalid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use http or https.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowLocal = options.allowLocal
    ?? (process.env.NODE_ENV !== 'production' && process.env.FLOWPR_DATA_MODE === 'local');
  if (!hostname || (!allowLocal && isExplicitlyLocalHostname(hostname))) {
    throw new Error('URL points to a private, loopback, or reserved network address.');
  }

  const addresses = isIP(hostname)
    ? [hostname]
    : await lookup(hostname, { all: true, verbatim: true })
      .then((results) => results.map((result) => result.address))
      .catch(() => []);

  if (addresses.length === 0) {
    if (options.requireResolution) {
      throw new Error('URL hostname could not be resolved.');
    }
    return parsed;
  }

  if (addresses.some(isBlockedAddress)) {
    const localOnly = allowLocal && addresses.every(isAllowedLocalAddress);
    if (!localOnly) {
      throw new Error('URL points to a private, loopback, or reserved network address.');
    }
  }

  return parsed;
}
