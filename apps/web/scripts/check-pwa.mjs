// Checks the production build for what makes Stow installable and usable offline.
// Run it after `vite build`: pnpm --filter @stow/web check:pwa
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const read = (file) => {
  const path = join(dist, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};

const html = read('index.html');
check(html.includes('rel="manifest"'), 'index.html links the web app manifest');
check(html.includes('registerSW.js'), 'index.html registers the service worker');
check(html.includes('rel="apple-touch-icon"'), 'index.html has an apple-touch-icon (iOS home screen)');
check(html.includes('apple-mobile-web-app-capable'), 'index.html has the iOS standalone meta tag');

const manifestText = read('manifest.webmanifest');
check(manifestText !== '', 'dist/manifest.webmanifest exists');
const manifest = manifestText ? JSON.parse(manifestText) : {};
check(manifest.start_url === '/', 'manifest start_url is /');
check(manifest.display === 'standalone', 'manifest display is standalone');
const icons = manifest.icons ?? [];
const hasIcon = (sizes, purpose) => icons.some((icon) => icon.sizes === sizes && (icon.purpose ?? 'any') === purpose);
check(hasIcon('192x192', 'any'), 'manifest has a 192x192 icon');
check(hasIcon('512x512', 'any'), 'manifest has a 512x512 icon');
check(hasIcon('512x512', 'maskable'), 'manifest has a maskable 512x512 icon');
for (const icon of icons) check(existsSync(join(dist, icon.src)), `icon file ${icon.src} is in dist`);
const share = manifest.share_target;
check(
  share?.action === '/share' &&
    share?.method === 'GET' &&
    share?.params?.title === 'title' &&
    share?.params?.text === 'text' &&
    share?.params?.url === 'url',
  'manifest share_target is GET /share with title, text and url',
);

const sw = read('sw.js');
check(sw !== '', 'dist/sw.js exists');
check(sw.includes('"index.html"'), 'sw.js precaches index.html');
check(sw.includes('NavigationRoute'), 'sw.js serves index.html for offline navigations');
check(sw.includes('"favicons"'), 'sw.js caches favicons at runtime');

if (failures.length > 0) {
  console.error(`PWA check failed:\n${failures.map((failure) => `  ✕ ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('PWA check passed.');
