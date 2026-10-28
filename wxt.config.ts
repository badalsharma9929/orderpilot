import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // `npm run dev` builds to .output/chrome-mv3-dev and reloads the extension on every
  // save. It does not open a separate browser: load that folder once in your own
  // Chrome (where you are logged in to the shops). See docs/EDITING.md.
  webExt: { disabled: true },
  dev: { server: { port: 3777 } },
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'OrderPilot',
    description: 'Cart builder, order tracker and invoice collector for Amazon.in, Flipkart and JioMart',
    permissions: [
      'sidePanel',
      'storage',
      'unlimitedStorage',
      'alarms',
      'tabs',
      'scripting',
      'downloads',
      'notifications',
      'offscreen',
    ],
    host_permissions: [
      'https://*.amazon.in/*',
      'https://*.flipkart.com/*',
      'https://*.jiomart.com/*',
      'https://api.anthropic.com/*',
    ],
    action: { default_title: 'Open OrderPilot' },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
