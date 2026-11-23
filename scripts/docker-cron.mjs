// Hourly job for the Docker install: wrangler dev doesn't fire Cron Triggers by itself, so call the Worker's
// scheduled handler at minute 17 of every hour, like the hosted cron ("17 * * * *" in wrangler.toml).
const URL = 'http://127.0.0.1:8787/__scheduled?cron=17+*+*+*+*';
const msToNext = () => {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(17, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime() - now.getTime();
};
async function run() {
  try {
    const res = await fetch(URL);
    console.log(`[cron] ${new Date().toISOString()} scheduled handler: HTTP ${res.status}`);
  } catch (e) {
    console.log(`[cron] ${new Date().toISOString()} scheduled handler not reachable: ${e instanceof Error ? e.message : e}`);
  }
  setTimeout(run, msToNext());
}
setTimeout(run, msToNext());
