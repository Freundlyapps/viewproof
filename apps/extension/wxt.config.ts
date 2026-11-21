import { defineConfig } from 'wxt';
import { toAscii } from './src/ascii';

// Chrome + Edge, one MV3 build (spec D4). YouTube hosts only (spec §10); a content script on ViewProof's own pages hands keyword facts to the web app.
export default defineConfig({
  // Chrome rejects scripts containing Unicode noncharacters; write the finished bundles as pure ASCII.
  vite: () => ({
    plugins: [{
      name: 'viewproof-ascii-only',
      enforce: 'post',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') chunk.code = toAscii(chunk.code);
      },
    }],
  }),
  manifest: {
    name: 'ViewProof',
    description: 'Views per hour, outlier score and tags on YouTube; keyword facts for ViewProof. Open source; your data stays in your browser.',
    host_permissions: ['https://www.youtube.com/*', 'https://suggestqueries-clients6.youtube.com/*'],
    permissions: ['storage'],
  },
});
