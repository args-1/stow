import { describe, expect, it } from 'vitest';
import { isFetchableUrl, parseHtmlMetadata } from '../../../supabase/functions/_shared/metadata.ts';

const page = 'https://example.com/blog/post';

describe('parseHtmlMetadata', () => {
  it('reads title, description, and icon from the head only', () => {
    const html = `<!doctype html><html><head>
      <title>  Hello &amp; welcome  </title>
      <meta name="description" content="A &quot;great&quot;
        post">
      <link rel="icon" href="/static/icon.png">
    </head><body><svg><title>ignored</title></svg><link rel="icon" href="/nope.png"></body></html>`;
    expect(parseHtmlMetadata(html, page)).toEqual({
      title: 'Hello & welcome',
      description: 'A "great" post',
      faviconUrl: 'https://example.com/static/icon.png',
    });
  });

  it('falls back to Open Graph / Twitter tags and /favicon.ico', () => {
    const html = `<head><meta property="og:title" content="OG Title"><meta name='twitter:description' content='Tweet desc'></head>`;
    expect(parseHtmlMetadata(html, page)).toEqual({
      title: 'OG Title',
      description: 'Tweet desc',
      faviconUrl: 'https://example.com/favicon.ico',
    });
  });

  it('prefers <title> over og:title and description over og:description', () => {
    const html = `<head><meta property="og:title" content="OG"><title>Real</title>
      <meta property="og:description" content="og desc"><meta name="Description" content="plain desc"></head>`;
    expect(parseHtmlMetadata(html, page)).toMatchObject({ title: 'Real', description: 'plain desc' });
  });

  it('uses apple-touch-icon when there is no rel=icon, resolved against <base>', () => {
    const html = `<head><base href="https://cdn.example.net/assets/"><link href="touch.png" rel="apple-touch-icon"></head>`;
    expect(parseHtmlMetadata(html, page).faviconUrl).toBe('https://cdn.example.net/assets/touch.png');
  });

  it('accepts "shortcut icon" and unquoted attributes, skips data: icons and mask-icon', () => {
    const html = `<head><link rel="mask-icon" href="/mask.svg"><link rel=icon href="data:image/png;base64,AAA"><link rel="shortcut icon" href=/fav.ico></head>`;
    expect(parseHtmlMetadata(html, page).faviconUrl).toBe('https://example.com/fav.ico');
  });

  it('decodes numeric entities, keeps invalid ones, and clips long values', () => {
    const html = `<title>It&#39;s &#x1F600; &#99999999;</title><meta name="description" content="${'d'.repeat(1200)}">`;
    const meta = parseHtmlMetadata(html, page);
    expect(meta.title).toBe("It's 😀 &#99999999;");
    expect(meta.description).toHaveLength(1000);
  });

  it('returns null text fields for an empty document', () => {
    expect(parseHtmlMetadata('', page)).toEqual({
      title: null,
      description: null,
      faviconUrl: 'https://example.com/favicon.ico',
    });
  });

  it('stays fast on many unclosed tags', () => {
    const html = '<meta '.repeat(50_000) + '<title'.repeat(50_000);
    const start = performance.now();
    const meta = parseHtmlMetadata(html, page);
    const elapsed = performance.now() - start;
    expect(meta.title).toBeNull();
    expect(elapsed).toBeLessThan(500);
  });
});

describe('isFetchableUrl', () => {
  it('allows public http(s) hosts and IPs', () => {
    for (const u of [
      'https://example.com/x',
      'http://news.ycombinator.com',
      'https://93.184.216.34/',
      'http://172.32.0.1',
      'http://100.128.0.1',
      'https://[2606:4700::1111]/',
    ]) {
      expect(isFetchableUrl(u), u).toBe(true);
    }
  });

  it('blocks other schemes, credentials, and local names', () => {
    for (const u of [
      'ftp://example.com',
      'file:///etc/passwd',
      'https://user:pw@example.com',
      'http://localhost:54321',
      'http://localhost.',
      'http://app.localhost',
      'http://printer.local',
      'http://metadata.google.internal',
      'http://intranet',
      'not a url',
    ]) {
      expect(isFetchableUrl(u), u).toBe(false);
    }
  });

  it('blocks private, loopback, link-local, CGNAT, and multicast IPs, including encoded forms', () => {
    for (const u of [
      'http://127.0.0.1',
      'http://0.0.0.0',
      'http://10.1.2.3',
      'http://172.16.0.1',
      'http://172.31.255.255',
      'http://192.168.1.1',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1',
      'http://224.0.0.1',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
    ]) {
      expect(isFetchableUrl(u), u).toBe(false);
    }
  });
});
