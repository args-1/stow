import { normalizeUrl } from '@linkstash/core';

export interface SharedLink {
  url: string;
  title: string | null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?\]]$/;

const count = (text: string, char: string) => text.split(char).length - 1;

/** Strips sentence punctuation after a URL, but keeps a `)` that closes a `(` inside the URL. */
function trimTrailing(url: string): string {
  let trimmed = url;
  for (;;) {
    if (TRAILING_PUNCTUATION.test(trimmed)) trimmed = trimmed.slice(0, -1);
    else if (trimmed.endsWith(')') && count(trimmed, ')') > count(trimmed, '(')) trimmed = trimmed.slice(0, -1);
    else return trimmed;
  }
}

/** Reads the GET /share?title&text&url request that the share sheet sends to the installed PWA. */
export function parseSharedLink(params: URLSearchParams): SharedLink | null {
  const text = params.get('text')?.trim() ?? '';
  const match = text.match(URL_IN_TEXT)?.[0];
  const inText = match ? trimTrailing(match) : undefined;
  const url =
    normalizeUrl(params.get('url') ?? '') ?? (inText ? normalizeUrl(inText) : null) ?? normalizeUrl(text);
  if (!url) return null;
  return { url, title: params.get('title')?.trim() || null };
}
