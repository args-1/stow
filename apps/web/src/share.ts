import { normalizeUrl } from '@linkstash/core';

export interface SharedLink {
  url: string;
  title: string | null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** Reads the GET /share?title&text&url request that the share sheet sends to the installed PWA. */
export function parseSharedLink(params: URLSearchParams): SharedLink | null {
  const text = params.get('text')?.trim() ?? '';
  const inText = text.match(URL_IN_TEXT)?.[0].replace(TRAILING_PUNCTUATION, '');
  const url =
    normalizeUrl(params.get('url') ?? '') ?? (inText ? normalizeUrl(inText) : null) ?? normalizeUrl(text);
  if (!url) return null;
  return { url, title: params.get('title')?.trim() || null };
}
