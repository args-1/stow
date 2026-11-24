import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { handleMenuClick, SAVE_LINK_ITEM, SAVE_PAGE_ITEM, type Feedback } from '../lib/context-menu';
import { pageDescription } from '../lib/page';
import { getServices } from '../lib/services';

const WEB_PAGES = ['http://*/*', 'https://*/*'];
const FEEDBACK_MS = 4000;
const timers = new Map<number | undefined, ReturnType<typeof setTimeout>>();

/** Shows feedback on the toolbar icon of one tab (or of every tab when there is none), then restores it. */
function flash(tabId: number | undefined, feedback: Feedback): void {
  const target = tabId !== undefined && tabId >= 0 ? { tabId } : {};
  const ignoreClosedTab = () => undefined;
  clearTimeout(timers.get(tabId));
  Promise.all([
    browser.action.setBadgeBackgroundColor({ ...target, color: feedback.color }),
    browser.action.setBadgeText({ ...target, text: feedback.text }),
    browser.action.setTitle({ ...target, title: feedback.title }),
  ]).catch(ignoreClosedTab);
  timers.set(
    tabId,
    setTimeout(() => {
      timers.delete(tabId);
      Promise.all([
        browser.action.setBadgeText({ ...target, text: '' }),
        browser.action.setTitle({ ...target, title: 'Linkstash' }),
      ]).catch(ignoreClosedTab);
    }, FEEDBACK_MS),
  );
}

export default defineBackground(() => {
  // Menus persist across browser restarts in Chrome and in Firefox event pages, so create them once per install
  // or update. removeAll() first avoids duplicate-id errors when an update re-runs this.
  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: SAVE_LINK_ITEM,
      title: 'Save link to Linkstash',
      contexts: ['link'],
      targetUrlPatterns: WEB_PAGES,
    });
    browser.contextMenus.create({
      id: SAVE_PAGE_ITEM,
      title: 'Save page to Linkstash',
      contexts: ['page'],
      documentUrlPatterns: WEB_PAGES,
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    void handleMenuClick(
      {
        services: getServices(),
        describePage: pageDescription,
        flash: (feedback) => flash(tab?.id, feedback),
      },
      info,
      tab,
    );
  });
});
