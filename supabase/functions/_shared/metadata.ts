// Pure, dependency-free helpers shared by the fetch-metadata Edge Function (Deno) and core's tests (Node).

export interface PageMetadata {
  title: string | null;
  description: string | null;
  faviconUrl: string | null;
}

// These mirror LIMITS in packages/core/src/model.ts. The Edge Function can't import workspace packages.
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 1000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    const c = code.toLowerCase();
    try {
      if (c.startsWith('#x')) return String.fromCodePoint(parseInt(c.slice(2), 16));
      if (c.startsWith('#')) return String.fromCodePoint(parseInt(c.slice(1), 10));
    } catch {
      return match; // out-of-range code point
    }
    return NAMED_ENTITIES[c] ?? match;
  });
}

function cleanText(raw: string | undefined, max: number): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function tagAttributes(tag: string): Record<string, string> {
  const body = tag.replace(/^<[a-z]+/i, '').replace(/\/?>$/, '');
  const attrs: Record<string, string> = {};
  for (const m of body.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function tags(head: string, name: string): Record<string, string>[] {
  // Ending at `$` too keeps this linear: an unclosed tag would otherwise rescan to end-of-input for every
  // later `<name`. Unclosed matches are dropped, as before.
  return [...head.matchAll(new RegExp(`<${name}\\b[^>]*(?:>|$)`, 'gi'))]
    .filter((m) => m[0].endsWith('>'))
    .map((m) => tagAttributes(m[0]));
}

// Same result as /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i, but linear when <title is never closed.
function titleText(head: string): string | undefined {
  const open = /<title\b/i.exec(head);
  if (!open) return undefined;
  const start = head.indexOf('>', open.index) + 1;
  if (start === 0) return undefined;
  const close = /<\/title\s*>/gi;
  close.lastIndex = start;
  const end = close.exec(head);
  return end ? head.slice(start, end.index) : undefined;
}

function resolveHttp(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function parseHtmlMetadata(html: string, pageUrl: string): PageMetadata {
  const head = html.split(/<\/head\s*>/i)[0];

  const metas: Record<string, string> = {};
  for (const a of tags(head, 'meta')) {
    const key = (a.property ?? a.name ?? a.itemprop)?.toLowerCase();
    if (key && a.content !== undefined && !(key in metas)) metas[key] = a.content;
  }

  const titleTag = titleText(head);
  const title =
    cleanText(titleTag, MAX_TITLE) ?? cleanText(metas['og:title'], MAX_TITLE) ?? cleanText(metas['twitter:title'], MAX_TITLE);
  const description =
    cleanText(metas['description'], MAX_DESCRIPTION) ??
    cleanText(metas['og:description'], MAX_DESCRIPTION) ??
    cleanText(metas['twitter:description'], MAX_DESCRIPTION);

  const baseHref = tags(head, 'base').find((a) => a.href)?.href;
  const base = resolveHttp(baseHref, pageUrl) ?? pageUrl;

  const links = tags(head, 'link').map((a) => ({ rel: (a.rel ?? '').toLowerCase().split(/\s+/), href: a.href }));
  const firstIcon = (accept: (rel: string[]) => boolean) =>
    links.filter((l) => accept(l.rel)).map((l) => resolveHttp(l.href, base)).find((u) => u !== null) ?? null;

  const faviconUrl =
    firstIcon((rel) => rel.includes('icon')) ??
    firstIcon((rel) => rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) ??
    resolveHttp('/favicon.ico', base);

  return { title, description, faviconUrl };
}

function isPublicIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(ip: string): boolean {
  // The URL parser has already lowercased and compressed the address.
  if (ip.startsWith('::')) return false; // ::, ::1, ::ffff:x (IPv4-mapped), and other 0::/8 addresses
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return false; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return false; // fe80::/10 link-local
  return true;
}

/**
 * Cheap SSRF guard on the URL itself. It does not resolve DNS, so a public name that points at a
 * private address still passes. That is acceptable here because the function runs on Supabase's
 * network, not the user's.
 */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host.startsWith('[')) return isPublicIpv6(host.slice(1, -1));
  // WHATWG URL parsing already turned decimal/hex/short IPv4 forms into dotted quads.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPublicIpv4(host);
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
  return host.includes('.');
}
