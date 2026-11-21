import { defineConfig } from 'wxt';

// Chrome + Edge, one MV3 build (spec D4). YouTube hosts only (spec §10); a content script on ViewProof's own pages hands keyword facts to the web app.
export default defineConfig({
  manifest: {
    name: 'ViewProof',
    description: 'Views per hour, outlier score and tags on YouTube; keyword facts for ViewProof. Open source; your data stays in your browser.',
    host_permissions: ['https://www.youtube.com/*', 'https://suggestqueries-clients6.youtube.com/*'],
    permissions: ['storage'],
  },
});
