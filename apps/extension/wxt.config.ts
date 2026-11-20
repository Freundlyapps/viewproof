import { defineConfig } from 'wxt';

// Chrome + Edge, one MV3 build (spec D4). YouTube only; no other hosts (spec §10).
export default defineConfig({
  manifest: {
    name: 'open-IQ',
    description: 'Views per hour, outlier score and tags on YouTube video pages. Open source; sends no data.',
    host_permissions: ['https://www.youtube.com/*'],
    permissions: ['storage'],
  },
});
