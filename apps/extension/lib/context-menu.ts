import { parseLinkInput, type LinkInput } from '@stow/core';
import { describeError, enrichLink, saveLink, type SaveDeps } from './save';

export const SAVE_LINK_ITEM = 'stow-save-link';
export const SAVE_PAGE_ITEM = 'stow-save-page';

export const SIGN_IN_MESSAGE = 'Sign in from the Stow toolbar button, then try again.';
export const SETUP_MESSAGE = 'This Stow build has no Supabase settings. See the README.';

/** What the toolbar icon shows for a few seconds after a context-menu save: badge text, badge color and tooltip. */
export interface Feedback {
  text: string;
  color: string;
  title: string;
}

const succeeded = (title: string): Feedback => ({ text: '✓', color: '#059669', title });
const failed = (title: string): Feedback => ({ text: '✕', color: '#dc2626', title });

/** The parts of a contextMenus.onClicked event the handler reads. */
export interface MenuClick {
  menuItemId: string | number;
  linkUrl?: string;
  pageUrl?: string;
}

export interface MenuTab {
  id?: number;
  title?: string;
  favIconUrl?: string;
}

export interface MenuServices extends SaveDeps {
  hasSession(): Promise<boolean>;
}

export interface MenuDeps {
  /** `null` when this build has no Supabase settings. */
  services: MenuServices | null;
  describePage(tabId: number): Promise<string | null>;
  flash(feedback: Feedback): void;
}

interface MenuTarget {
  input: LinkInput;
  /** Set for page saves, so the handler can read the page's meta description. */
  tabId?: number;
}

function menuTarget(click: MenuClick, tab?: MenuTab): MenuTarget | null {
  if (click.menuItemId === SAVE_LINK_ITEM && click.linkUrl) return { input: { url: click.linkUrl } };
  if (click.menuItemId === SAVE_PAGE_ITEM && click.pageUrl) {
    return {
      input: { url: click.pageUrl, title: tab?.title ?? null, faviconUrl: tab?.favIconUrl ?? null },
      tabId: tab?.id,
    };
  }
  return null;
}

/**
 * Saves the clicked link or page without a category, flashes the result on the toolbar icon, then fills in
 * missing metadata. Never throws: every failure becomes a ✕ badge.
 */
export async function handleMenuClick(deps: MenuDeps, click: MenuClick, tab?: MenuTab): Promise<void> {
  const target = menuTarget(click, tab);
  if (!target) return;
  const { services } = deps;
  if (!services) return deps.flash(failed(SETUP_MESSAGE));
  try {
    if (!(await services.hasSession())) return deps.flash(failed(SIGN_IN_MESSAGE));
    const description = target.tabId === undefined ? null : await deps.describePage(target.tabId);
    const parsed = parseLinkInput({ ...target.input, description });
    if (!parsed.ok) return deps.flash(failed(parsed.error));
    const result = await saveLink(services, parsed.value);
    if (result.status === 'duplicate') return deps.flash(succeeded('Already in Stow'));
    deps.flash(succeeded('Saved to Stow'));
    await enrichLink(services, result.link);
  } catch (error) {
    deps.flash(failed(describeError(error)));
  }
}
