import { isHttpUrl, type PageMetadataInput } from '@stow/core';
import { browser } from 'wxt/browser';

export interface PageInfo extends PageMetadataInput {
  url: string;
  tabId: number;
}

function readDescription(): string | null {
  const content = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content.trim() || null;
  return content('meta[property="og:description"]') ?? content('meta[name="description"]');
}

export async function pageDescription(tabId: number): Promise<string | null> {
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId }, func: readDescription });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

/** The active tab of the current window, or null if there is none or the browser hides its URL. */
export async function activePage(): Promise<PageInfo | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.id === undefined) return null;
  return {
    url: tab.url,
    tabId: tab.id,
    title: tab.title ?? null,
    faviconUrl: tab.favIconUrl ?? null,
    description: isHttpUrl(tab.url) ? await pageDescription(tab.id) : null,
  };
}
