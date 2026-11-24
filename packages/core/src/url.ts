const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const DOTTED_QUAD = /^\d{1,3}(\.\d{1,3}){3}$/;
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Returns a canonical http(s) URL, or null if the input is not a usable web URL. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hadScheme = HAS_SCHEME.test(trimmed);
  const candidate = hadScheme ? trimmed : `https://${trimmed}`;
  if (!isHttpUrl(candidate)) return null;
  const u = new URL(candidate);
  if (!hadScheme) {
    // Guess-mode input ("example.com") must look like a real host, not "hello" or "mailto:x@y".
    if (u.username || u.password) return null;
    // The parser turns "42" into 0.0.0.42, so check the host as typed: only a full dotted quad may be numeric.
    const typedHost = trimmed.split(/[/?#]/)[0].replace(/:\d*$/, '');
    if (/^[\d.]+$/.test(typedHost) && !DOTTED_QUAD.test(typedHost)) return null;
    const h = u.hostname;
    if (h !== 'localhost' && !h.includes('.') && !h.startsWith('[')) return null;
  }
  return u.href;
}

/** Key used to detect the same page saved twice. Pass a normalized URL. */
export function dedupeKey(url: string): string {
  const u = new URL(url);
  const host = u.host.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  const kept = [...u.searchParams].filter(([k]) => {
    const key = k.toLowerCase();
    return !key.startsWith('utm_') && !TRACKING_PARAMS.has(key);
  });
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  return `${host}${path}${query}`;
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function faviconFallback(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname(url))}&sz=64`;
}
