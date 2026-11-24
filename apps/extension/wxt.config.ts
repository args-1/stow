import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  imports: false,
  autoIcons: { baseIconPath: 'assets/icon.svg' },
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ browser }) => ({
    name: 'Linkstash',
    description: 'Save the current page or any link to your Linkstash library.',
    permissions: ['activeTab', 'contextMenus', 'scripting', 'storage'],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+S' } },
    },
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'linkstash@example.com', strict_min_version: '115.0' } } }
      : {}),
  }),
});
