// Manual parser-drift check (spec §11): fetch ONE real channel feed and fail loudly
// if it parses to nothing. Not for CI or loops — one request per run.
import { parseChannelFeed } from '../src/feed.ts';

const channelId = process.argv[2] ?? 'UCHnyfMqiRRG1u-2MsSQLbXA';
const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
if (!res.ok) {
  console.error(`canary: HTTP ${res.status}`);
  process.exit(1);
}
const r = parseChannelFeed(await res.text());
if (!r.ok) {
  console.error(`canary: parse failed: ${r.reason}`);
  process.exit(1);
}
const missing = r.value.filter((v) => v.views === null).length;
if (r.value.length === 0 || missing > 0) {
  console.error(`canary: ${r.value.length} entries, ${missing} without views`);
  process.exit(1);
}
console.log(`canary ok: ${r.value.length} entries, formats ${JSON.stringify(Object.groupBy(r.value, (v) => v.format), (k, v) => (Array.isArray(v) ? v.length : v))}`);
