/**
 * AUD-3 Phase B (OSE-1447): mask an operator IP for a brand-scoped audit read.
 *
 * IPv4 keeps its /24 (a.b.c.0/24), IPv6 its /48 (first three hextets), and an
 * IPv4-mapped IPv6 address is masked as the IPv4 it carries. That is enough for
 * abuse triage ("same network?") and no longer names one machine. Anything that
 * does not parse as an IP returns null: a value we cannot mask is never shown.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function maskIpv4(ip: string): string | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

/** Expand an IPv6 address to its 8 hextets, or null when it is not one. */
function ipv6Hextets(ip: string): string[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || ip.length > 39) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...head, ...tail].some((h) => h.length === 0 || h.length > 4)) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array<string>(missing).fill('0'), ...tail].map((h) =>
    h.toLowerCase().replace(/^0+(?=.)/, '')
  );
}

export function maskIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const ip = raw.trim();
  if (ip.length === 0) return null;

  const v4 = maskIpv4(ip);
  if (v4) return v4;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d): mask the IPv4 it carries.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return maskIpv4(mapped[1]);

  const hextets = ipv6Hextets(ip);
  if (!hextets) return null;
  return `${hextets.slice(0, 3).join(':')}::/48`;
}
