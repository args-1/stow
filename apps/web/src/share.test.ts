import { describe, expect, it } from 'vitest';
import { parseSharedLink } from './share';

const parse = (query: string) => parseSharedLink(new URLSearchParams(query));

describe('parseSharedLink', () => {
  it('uses the url parameter and the trimmed title', () => {
    expect(parse('title=%20Hello%20&url=example.com/a')).toEqual({ url: 'https://example.com/a', title: 'Hello' });
  });

  it('finds a URL inside the shared text and drops trailing punctuation', () => {
    const text = encodeURIComponent('Read this: https://example.com/post?id=1).');
    expect(parse(`text=${text}`)).toEqual({ url: 'https://example.com/post?id=1', title: null });
  });

  it('accepts a bare domain as the text', () => {
    expect(parse('text=example.org')).toEqual({ url: 'https://example.org/', title: null });
  });

  it('returns null when nothing usable was shared', () => {
    expect(parse('')).toBeNull();
    expect(parse('title=Hi&text=no%20link%20here')).toBeNull();
    expect(parse('url=javascript:alert(1)')).toBeNull();
  });
});
