import type { AuthStorage } from '@stow/core';
import { browser } from 'wxt/browser';

/** Keeps the Supabase session in extension storage, which the popup and the background worker share. */
export const extensionAuthStorage: AuthStorage = {
  async getItem(key) {
    const items = await browser.storage.local.get(key);
    const value = items[key];
    return typeof value === 'string' ? value : null;
  },
  async setItem(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await browser.storage.local.remove(key);
  },
};
