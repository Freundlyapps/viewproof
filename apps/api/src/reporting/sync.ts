// YouTube Reporting API: one job per channel and report type, daily CSV files downloaded by the hourly job
// (and jobs started as soon as the Thumbnails page is opened). Stored rows are kept 30 days after download.
import { todayPacific } from '@viewproof/core';
import type { ChannelRow, ReportingJobRow } from '@viewproof/db';
import type { Deps } from '../app';
import { type ChannelAccess, REVOKED_REASON, accessFor } from '../channel-data';
import type { GoogleError } from '../google';

export const REPORT_TYPES = { reach: 'channel_reach_basic_a1', sources: 'channel_reach_combined_a1', endScreens: 'channel_end_screens_a2' } as const;
const ALL_TYPES: string[] = Object.values(REPORT_TYPES);
/** Every table holding Reporting API data of a channel (deleted with the channel or the account). */
export const REPORTING_TABLES = ['reach_daily', 'reach_source_daily', 'end_screen_daily', 'reporting_jobs'] as const;
const DAY_MS = 86_400_000;
/** YouTube API data from the channel is kept 30 days after download (YouTube API Services storage rules). */
export const REACH_KEEP_MS = 30 * DAY_MS;
/** How often a job's file list is checked; YouTube adds one file a day. */
const CHECK_EVERY_MS = 6 * 3_600_000;
/** A job YouTube refused is tried again after a day. */
const RETRY_FAILED_MS = DAY_MS;
/** Files downloaded per channel per run, so one run stays short (the 30-day backfill takes a few runs). */
const FILES_PER_RUN = 12;
/** Channels synced per hourly run. */
const CHANNELS_PER_RUN = 5;

const isErr = (x: unknown): x is GoogleError => !!x && typeof x === 'object' && ['revoked', 'failed', 'forbidden'].includes(String((x as { kind?: unknown }).kind));
const iso = (ms: number) => new Date(ms).toISOString();

/** RFC 4180 CSV → header and rows (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) out.push(row);
  const [header = [], ...rows] = out;
  return { header: header.map((h) => h.trim()), rows };
}

/**
 * YouTube's click-through rate in 0–1. Its docs call it a percentage without giving the scale; a file with any
 * value above 1 is read as percent (0–100), otherwise as a fraction. This only changes the unit, not the value.
 */
export function ctrScale(values: number[]): number {
  return values.some((v) => v > 1) ? 0.01 : 1;
}

/**
 * One day's file of a report type → the rows to store for that day (the day's earlier rows are replaced).
 * reach: one row per video as YouTube gave it (impressions, ctr). sources and end screens: counts summed over
 * the report's other columns (device, country, element…); no rates are computed (YouTube policy III.E.4.h).
 */
export function rowsOf(type: string, csv: string): { key: string[]; impressions: number; second: number | null }[] {
  const { header, rows } = parseCsv(csv);
  const col = (name: string) => header.indexOf(name);
  const vid = col('video_id');
  const num = (r: string[], i: number) => (i >= 0 && r[i] !== undefined && r[i] !== '' && Number.isFinite(Number(r[i])) ? Number(r[i]) : null);
  if (type === REPORT_TYPES.reach) {
    const imp = col('video_thumbnail_impressions');
    const ctr = col('video_thumbnail_impressions_ctr');
    const scale = ctrScale(rows.map((r) => num(r, ctr) ?? 0));
    return rows.flatMap((r) => {
      const i = num(r, imp) ?? 0;
      const c = num(r, ctr);
      return i > 0 ? [{ key: [r[vid] ?? ''], impressions: i, second: c === null ? null : c * scale }] : [];
    });
  }
  const sums = new Map<string, { impressions: number; clicks: number }>();
  const ends = type === REPORT_TYPES.endScreens;
  const imp = col(ends ? 'end_screen_element_impressions' : 'video_thumbnail_impressions');
  const clk = col('end_screen_element_clicks');
  const src = col('traffic_source_type');
  for (const r of rows) {
    const k = ends ? (r[vid] ?? '') : `${r[vid] ?? ''}\u0000${r[src] ?? ''}`;
    const s = sums.get(k) ?? { impressions: 0, clicks: 0 };
    s.impressions += num(r, imp) ?? 0;
    s.clicks += ends ? (num(r, clk) ?? 0) : 0;
    sums.set(k, s);
  }
  return [...sums].filter(([, s]) => s.impressions > 0).map(([k, s]) => ({ key: k.split('\u0000'), impressions: s.impressions, second: ends ? s.clicks : null }));
}

/** Store one day's rows for a report type, replacing what was stored for that day (YouTube re-sends days it corrects). */
async function store(deps: Deps, ch: ChannelRow, type: string, day: string, csv: string): Promise<void> {
  const now = iso(deps.now());
  const rows = rowsOf(type, csv);
  const table = type === REPORT_TYPES.reach ? 'reach_daily' : type === REPORT_TYPES.sources ? 'reach_source_daily' : 'end_screen_daily';
  const stmts = [deps.db.prepare(`DELETE FROM ${table} WHERE channel_id = ? AND day = ?`).bind(ch.id, day)];
  for (const r of rows) {
    if (type === REPORT_TYPES.sources) {
      const source = Number(r.key[1]);
      if (r.key[1] === '' || !Number.isInteger(source)) continue;
      stmts.push(deps.db.prepare('INSERT OR REPLACE INTO reach_source_daily (channel_id, day, video_id, source, impressions, fetched_at) VALUES (?, ?, ?, ?, ?, ?)').bind(ch.id, day, r.key[0], source, Math.round(r.impressions), now));
    } else if (type === REPORT_TYPES.reach) {
      stmts.push(deps.db.prepare('INSERT OR REPLACE INTO reach_daily (channel_id, day, video_id, impressions, ctr, fetched_at) VALUES (?, ?, ?, ?, ?, ?)').bind(ch.id, day, r.key[0], Math.round(r.impressions), r.second, now));
    } else {
      stmts.push(deps.db.prepare('INSERT OR REPLACE INTO end_screen_daily (channel_id, day, video_id, impressions, clicks, fetched_at) VALUES (?, ?, ?, ?, ?, ?)').bind(ch.id, day, r.key[0], Math.round(r.impressions), Math.round(r.second ?? 0), now));
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await deps.db.batch(stmts.slice(i, i + 100));
}

export async function jobsOf(deps: Deps, channelRowId: string): Promise<ReportingJobRow[]> {
  return (await deps.db.prepare('SELECT * FROM reporting_jobs WHERE channel_id = ?').bind(channelRowId).all<ReportingJobRow>()).results;
}

async function saveJob(deps: Deps, ch: ChannelRow, type: string, jobId: string | null, reason: string | null): Promise<void> {
  const now = iso(deps.now());
  await deps.db.prepare(`INSERT INTO reporting_jobs (channel_id, report_type, job_id, status, status_reason, created_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, report_type) DO UPDATE SET job_id = excluded.job_id, status = excluded.status, status_reason = excluded.status_reason, checked_at = excluded.checked_at, last_file_created = NULL`)
    .bind(ch.id, type, jobId, jobId ? 'ok' : 'failed', reason, now, jobId ? null : now).run();
}

/** Make sure the channel has a job for every report type (reusing jobs that already exist on YouTube). */
export async function ensureJobs(deps: Deps, a: ChannelAccess): Promise<GoogleError | null> {
  const have = await jobsOf(deps, a.channel.id);
  const due = ALL_TYPES.filter((t) => {
    const j = have.find((x) => x.report_type === t);
    return !j || (j.status === 'failed' && deps.now() - Date.parse(j.checked_at ?? j.created_at) >= RETRY_FAILED_MS);
  });
  if (!due.length) return null;
  const existing = await deps.youtube.reportingJobs(a.accessToken);
  if (isErr(existing)) {
    if (existing.kind === 'revoked') return existing;
    for (const t of due) await saveJob(deps, a.channel, t, null, existing.reason);
    return null;
  }
  for (const t of due) {
    const found = existing.find((j) => j.reportTypeId === t);
    const job = found ?? (await deps.youtube.createReportingJob(a.accessToken, t));
    if (isErr(job)) {
      if (job.kind === 'revoked') return job;
      await saveJob(deps, a.channel, t, null, job.reason);
    } else await saveJob(deps, a.channel, t, job.id, null);
  }
  return null;
}

/** Download the new files of every due job of one channel. */
export async function syncChannel(deps: Deps, a: ChannelAccess): Promise<GoogleError | null> {
  const err = await ensureJobs(deps, a);
  if (err) return err;
  const oldest = todayPacific(deps.now() - REACH_KEEP_MS);
  let budget = FILES_PER_RUN;
  for (const j of await jobsOf(deps, a.channel.id)) {
    if (j.status !== 'ok' || !j.job_id || budget <= 0) continue;
    if (j.checked_at && deps.now() - Date.parse(j.checked_at) < CHECK_EVERY_MS) continue;
    const files = await deps.youtube.reportingFiles(a.accessToken, j.job_id, j.last_file_created);
    if (files === null) {
      // The job was deleted on YouTube: make a new one next time.
      await deps.db.prepare('DELETE FROM reporting_jobs WHERE channel_id = ? AND report_type = ?').bind(a.channel.id, j.report_type).run();
      continue;
    }
    if (isErr(files)) {
      if (files.kind === 'revoked') return files;
      await deps.db.prepare('UPDATE reporting_jobs SET status_reason = ?, checked_at = ? WHERE channel_id = ? AND report_type = ?').bind(files.reason, iso(deps.now()), a.channel.id, j.report_type).run();
      continue;
    }
    let last = j.last_file_created;
    let complete = true;
    for (const f of files) {
      if (budget <= 0) { complete = false; break; }
      const day = todayPacific(Date.parse(f.startTime));
      if (day >= oldest) {
        budget--;
        const csv = await deps.youtube.download(a.accessToken, f.downloadUrl);
        if (isErr(csv)) {
          if (csv.kind === 'revoked') return csv;
          complete = false;
          break;
        }
        await store(deps, a.channel, j.report_type, day, csv);
      }
      last = f.createTime;
    }
    // Checked only once every listed file is in; otherwise the next run continues where this one stopped.
    await deps.db.prepare('UPDATE reporting_jobs SET last_file_created = ?, status_reason = NULL, checked_at = ? WHERE channel_id = ? AND report_type = ?')
      .bind(last, complete ? iso(deps.now()) : j.checked_at, a.channel.id, j.report_type).run();
  }
  return null;
}

/** Hourly: delete rows older than 30 days, then sync the channels that waited longest. */
export async function runReportingCron(deps: Deps): Promise<void> {
  const cutoff = iso(deps.now() - REACH_KEEP_MS);
  await deps.db.batch(['reach_daily', 'reach_source_daily', 'end_screen_daily'].map((t) => deps.db.prepare(`DELETE FROM ${t} WHERE fetched_at < ?`).bind(cutoff)));
  const due = (await deps.db.prepare(`SELECT c.* FROM channels c LEFT JOIN (SELECT channel_id, MIN(COALESCE(checked_at, '')) AS seen FROM reporting_jobs GROUP BY channel_id) j ON j.channel_id = c.id
    WHERE c.status = 'active' AND (j.seen IS NULL OR j.seen < ?) ORDER BY COALESCE(j.seen, '') LIMIT ?`).bind(iso(deps.now() - CHECK_EVERY_MS), CHANNELS_PER_RUN).all<ChannelRow>()).results;
  for (const ch of due) {
    try {
      const a = await accessFor(deps, ch);
      if ('error' in a) continue;
      const err = await syncChannel(deps, a);
      if (err?.kind === 'revoked') await deps.db.prepare("UPDATE channels SET status = 'reconnect', status_reason = ? WHERE id = ?").bind(REVOKED_REASON, ch.id).run();
    } catch (e) {
      console.error('reporting sync failed', ch.id, e instanceof Error ? e.message : e);
    }
  }
}
