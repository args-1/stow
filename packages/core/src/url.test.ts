import { describe, expect, it } from 'vitest';
import { dedupeKey, faviconFallback, hostname, isHttpUrl, normalizeUrl } from './url';

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/x')).toBe(true);
  });
  it('rejects other schemes and garbage', () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('adds https:// when no scheme is given', () => {
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
  });
  it('keeps an explicit http scheme, lowercases the host, and trims', () => {
    expect(normalizeUrl('  http://Example.com  ')).toBe('http://example.com/');
  });
  it('accepts localhost with a port', () => {
    expect(normalizeUrl('localhost:5173')).toBe('https://localhost:5173/');
  });
  it('accepts single-label hosts only when the scheme is explicit', () => {
    expect(normalizeUrl('http://nas:8080/')).toBe('http://nas:8080/');
    expect(normalizeUrl('hello')).toBeNull();
  });
  it('rejects bare numbers but accepts a dotted-quad IPv4 when no scheme is given', () => {
    expect(normalizeUrl('42')).toBeNull();
    expect(normalizeUrl('1.2')).toBeNull();
    expect(normalizeUrl('192.168.1.10')).toBe('https://192.168.1.10/');
  });
  it('rejects empty input, non-http schemes, and junk', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('ftp://example.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('hello world')).toBeNull();
    expect(normalizeUrl('mailto:me@example.com')).toBeNull();
  });
});

describe('dedupeKey', () => {
  it('ignores scheme, www, host case, trailing slashes, and fragments', () => {
    const key = dedupeKey('https://example.com/a/b');
    expect(key).toBe('example.com/a/b');
    expect(dedupeKey('http://WWW.Example.com/a/b/')).toBe(key);
    expect(dedupeKey('https://example.com/a/b#section')).toBe(key);
  });
  it('drops tracking params but keeps meaningful ones', () => {
    expect(
      dedupeKey('https://example.com/p?id=7&utm_source=x&UTM_Medium=y&fbclid=1&gclid=2&mc_cid=3&mc_eid=4'),
    ).toBe('example.com/p?id=7');
  });
  it('keeps the port and treats the root path as empty', () => {
    expect(dedupeKey('http://localhost:3000/')).toBe('localhost:3000');
    expect(dedupeKey('https://example.com')).toBe('example.com');
  });
});

describe('hostname / faviconFallback', () => {
  it('strips www and returns the input when it cannot be parsed', () => {
    expect(hostname('https://www.example.com/x')).toBe('example.com');
    expect(hostname('nope')).toBe('nope');
  });
  it('builds a Google s2 favicon URL', () => {
    expect(faviconFallback('https://www.example.com/x')).toBe(
      'https://www.google.com/s2/favicons?domain=example.com&sz=64',
    );
  });
});
