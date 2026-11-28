import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { Audience, Earnings, Thumbnails, VideoCheckup, Videos } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import { createApp } from '../src/app';
import { SCOPES } from '../src/google';
import { REPORT_TYPES, ctrScale, parseCsv, rowsOf, runReportingCron, syncChannel } from '../src/reporting/sync';
import { httpYouTubeClient, type ReportQuery, type ReportingFile, type Upload, type VideoDetails, type YouTubeClient } from '../src/youtube';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { ALL_SCOPES, channelFixture, makeDeps, post, signIn } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const DAY = 86_400_000;
async function connected(sub: string, channelId: string, revenue = false) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }), scopes: revenue ? [...ALL_SCOPES, SCOPES.revenue] : ALL_SCOPES, query: revenue ? '?revenue=1' : '' });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>())!;
  return { cookie: s.cookie, row, app: s.app };
}
function setup(yt: Partial<YouTubeClient>, now = NOW) {
  const youtube = fakeYouTube(yt);
  const deps = makeDeps({ youtube, google: fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) }), now: () => now });
  return { app: createApp(deps), youtube, deps };
}
const getJson = async <T>(app: ReturnType<typeof createApp>, path: string, cookie: string) => (await app.request(path, { headers: { cookie } })).json() as Promise<T>;
const up = (videoId: string, title: string): Upload => ({ videoId, title, publishedAt: '2026-10-01T10:00:00Z', durationSec: 600, views: 100, thumbnailUrl: `t-${videoId}` });
const daily = { columns: ['day', 'views'], rows: [['2026-11-19', 3]] };
const file = (day: string, created: string, id = day): ReportingFile => ({ id, startTime: `${day}T08:00:00Z`, createTime: created, downloadUrl: `https://youtubereporting.googleapis.com/v1/media/${id}` });
const count = async (table: string, channelId: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE channel_id = ?`).bind(channelId).first<{ n: number }>())!.n;

describe('reporting CSV', () => {
  test('quoted fields, doubled quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual({ header: ['a', 'b'], rows: [['x, y', 'say "hi"']] });
  });

  test('CTR scale: fraction unless a value is above 1', () => {
    expect(ctrScale([0.02, 0.5])).toBe(1);
    expect(ctrScale([0.5, 4.2])).toBe(0.01);
  });

  test('reach rows as YouTube gave them; sources and end screens as summed counts, no rates', () => {
    expect(rowsOf(REPORT_TYPES.reach, 'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261119,UC,a,1000,0.05\n20261119,UC,b,0,0\n')).toEqual([{ key: ['a'], impressions: 1000, second: 0.05 }]);
    // Percent scale: 5 means 5% (only the unit changes).
    expect(rowsOf(REPORT_TYPES.reach, 'video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\na,200,5\n')[0]!.second).toBeCloseTo(0.05);
    const src = rowsOf(REPORT_TYPES.sources, 'video_id,traffic_source_type,device_type,video_thumbnail_impressions,video_thumbnail_impressions_ctr\na,3,101,100,0.1\na,3,104,300,0.1\na,5,104,50,0.2\n');
    expect(src).toEqual([{ key: ['a', '3'], impressions: 400, second: null }, { key: ['a', '5'], impressions: 50, second: null }]);
    expect(rowsOf(REPORT_TYPES.endScreens, 'video_id,end_screen_element_type,end_screen_element_impressions,end_screen_element_clicks\na,501,40,3\na,505,60,1\n')).toEqual([{ key: ['a'], impressions: 100, second: 4 }]);
  });

  test('download sends the token only to Google', async () => {
    const seen: string[] = [];
    const yt = httpYouTubeClient((async (u: string) => { seen.push(u); return new Response('a,b\n'); }) as unknown as typeof fetch);
    expect(await yt.download('tok', 'https://evil.example/x')).toEqual({ kind: 'failed', reason: 'Unexpected download address' });
    expect(await yt.download('tok', 'https://youtubereporting.googleapis.com/v1/media/x')).toBe('a,b\n');
    expect(seen).toEqual(['https://youtubereporting.googleapis.com/v1/media/x']);
  });
});

describe('reporting sync', () => {
  test('creates the jobs (reusing one that exists), downloads new files, skips days past 30, checks again only after 6 hours', async () => {
    const { row } = await connected('rp-sync', 'UCrpsync');
    const csv: Record<string, string> = {
      [REPORT_TYPES.reach]: 'video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\na,1000,0.04\n',
      [REPORT_TYPES.sources]: 'video_id,traffic_source_type,video_thumbnail_impressions,video_thumbnail_impressions_ctr\na,3,1000,0.04\n',
      [REPORT_TYPES.endScreens]: 'video_id,end_screen_element_impressions,end_screen_element_clicks\na,50,5\n',
    };
    const { youtube, deps } = setup({
      reportingJobs: async () => [{ id: 'old-reach', reportTypeId: REPORT_TYPES.reach }],
      reportingFiles: async (_t, job) => [file('2026-10-01', '2026-10-03T00:00:00Z', `${job}-old`), file('2026-11-19', '2026-11-20T00:00:00Z', `${job}-new`)],
      download: async (_t, url) => csv[Object.values(REPORT_TYPES).find((t) => url.includes(t)) ?? REPORT_TYPES.reach]!,
    });
    const a = { channel: row, accessToken: 'at' };
    expect(await syncChannel(deps, a)).toBeNull();
    expect(youtube.calls.filter((c) => c.method === 'createReportingJob').map((c) => c.arg)).toEqual([REPORT_TYPES.sources, REPORT_TYPES.endScreens]);
    // Only the 2026-11-19 file of each job was downloaded (2026-10-01 is older than 30 days).
    expect(youtube.calls.filter((c) => c.method === 'download')).toHaveLength(3);
    expect(await env.DB.prepare('SELECT day, video_id, impressions, ctr FROM reach_daily WHERE channel_id = ?').bind(row.id).all()).toMatchObject({ results: [{ day: '2026-11-19', video_id: 'a', impressions: 1000, ctr: 0.04 }] });
    expect(await count('reach_source_daily', row.id)).toBe(1);
    expect(await count('end_screen_daily', row.id)).toBe(1);
    const jobs = (await env.DB.prepare('SELECT report_type, job_id, last_file_created FROM reporting_jobs WHERE channel_id = ? ORDER BY report_type').bind(row.id).all()).results;
    expect(jobs).toContainEqual({ report_type: REPORT_TYPES.reach, job_id: 'old-reach', last_file_created: '2026-11-20T00:00:00Z' });
    youtube.calls.length = 0;
    await syncChannel(deps, a);
    expect(youtube.calls.filter((c) => c.method === 'reportingFiles')).toHaveLength(0);
  });

  test('a corrected day replaces the stored one; a deleted job is made again', async () => {
    const { row } = await connected('rp-replace', 'UCrpreplace');
    let n = 0;
    let gone = false;
    const { deps } = setup({
      reportingFiles: async (_t, job) => (gone && job.includes('reach') ? null : [file('2026-11-19', `2026-11-2${n}T00:00:00Z`)]),
      download: async () => (n === 0 ? 'video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\na,10,0.1\nb,5,0.1\n' : 'video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\na,20,0.1\n'),
    });
    const a = { channel: row, accessToken: 'at' };
    await syncChannel(deps, a);
    expect(await count('reach_daily', row.id)).toBe(2);
    n = 1;
    await env.DB.prepare('UPDATE reporting_jobs SET checked_at = NULL WHERE channel_id = ?').bind(row.id).run();
    await syncChannel(deps, a);
    expect(await env.DB.prepare('SELECT video_id, impressions FROM reach_daily WHERE channel_id = ?').bind(row.id).all()).toMatchObject({ results: [{ video_id: 'a', impressions: 20 }] });
    gone = true;
    await env.DB.prepare('UPDATE reporting_jobs SET checked_at = NULL WHERE channel_id = ?').bind(row.id).run();
    await syncChannel(deps, a);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM reporting_jobs WHERE channel_id = ? AND report_type = ?').bind(row.id, REPORT_TYPES.reach).first()).toEqual({ n: 0 });
  });

  test('the hourly job deletes rows downloaded more than 30 days ago', async () => {
    const { row } = await connected('rp-prune', 'UCrpprune');
    const old = new Date(NOW - 31 * DAY).toISOString();
    const fresh = new Date(NOW - DAY).toISOString();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, 1, 1, ?)').bind(row.id, '2026-10-19', 'a', old),
      env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, 1, 1, ?)').bind(row.id, '2026-11-19', 'a', fresh),
      env.DB.prepare('INSERT INTO end_screen_daily VALUES (?, ?, ?, 1, 1, ?)').bind(row.id, '2026-10-19', 'a', old),
    ]);
    await runReportingCron(setup({}).deps);
    expect(await count('reach_daily', row.id)).toBe(1);
    expect(await count('end_screen_daily', row.id)).toBe(0);
  });

  test('removing the channel deletes its reporting data', async () => {
    const { row, cookie, app } = await connected('rp-rm', 'UCrprm');
    await env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, 1, 1, ?)').bind(row.id, '2026-11-19', 'a', new Date(NOW).toISOString()).run();
    await env.DB.prepare("INSERT INTO reporting_jobs (channel_id, report_type, job_id, status, created_at) VALUES (?, 'x', 'j', 'ok', ?)").bind(row.id, new Date(NOW).toISOString()).run();
    await post(app, `/channels/${row.id}/remove`, cookie);
    expect(await count('reach_daily', row.id)).toBe(0);
    expect(await count('reporting_jobs', row.id)).toBe(0);
  });
});

describe('thumbnails page', () => {
  test('first visit starts the jobs and says data is on its way', async () => {
    const { row, cookie } = await connected('rp-wait', 'UCrpwait');
    const { app, youtube } = setup({});
    const t = await getJson<Thumbnails>(app, `/api/channels/${row.id}/thumbnails`, cookie);
    expect(t.status).toBe('waiting');
    expect(t.reason).toContain('2026-11-21');
    expect(youtube.calls.filter((c) => c.method === 'createReportingJob')).toHaveLength(3);
  });

  test('YouTube refusing every job is shown with its reason', async () => {
    const { row, cookie } = await connected('rp-fail', 'UCrpfail');
    const { app } = setup({ reportingJobs: async () => ({ kind: 'forbidden', reason: 'YouTube Reporting API has not been used in project' }) });
    const t = await getJson<Thumbnails>(app, `/api/channels/${row.id}/thumbnails`, cookie);
    expect(t).toMatchObject({ status: 'failed', reason: expect.stringContaining('YouTube Reporting API has not been used') });
  });

  test('totals, days, videos with titles, sources and end screens', async () => {
    const { row, cookie } = await connected('rp-ok', 'UCrpok');
    const at = new Date(NOW).toISOString();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-18', 'a', 1000, 0.05, at),
      env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-19', 'a', 1000, 0.03, at),
      env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-19', 'b', 2000, 0.01, at),
      env.DB.prepare('INSERT INTO reach_source_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-19', 'a', 3, 3000, at),
      env.DB.prepare('INSERT INTO reach_source_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-19', 'a', 5, 1000, at),
      env.DB.prepare('INSERT INTO end_screen_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-19', 'a', 200, 10, at),
    ]);
    const { app } = setup({ uploads: async () => [up('a', 'Alpha'), up('b', 'Beta')] });
    const t = await getJson<Thumbnails>(app, `/api/channels/${row.id}/thumbnails?range=7d`, cookie);
    expect(t.status).toBe('ok');
    expect(t.days).toEqual({ from: '2026-11-18', to: '2026-11-19', count: 2 });
    expect(t.totals.impressions).toMatchObject({ kind: 'value', value: 4000 });
    expect(t.totals).not.toHaveProperty('ctr');
    expect(t.videos.map((v) => `${v.title}:${v.impressions}`).sort()).toEqual(['Alpha:2000', 'Beta:2000']);
    const alpha = t.videos.find((v) => v.title === 'Alpha')!;
    // YouTube's own daily values, latest day first-class; no period rate is computed.
    expect(alpha.latestCtr).toMatchObject({ kind: 'value', value: 0.03, inputs: { day: '2026-11-19' } });
    expect(alpha.ctrByDay).toEqual([{ date: '2026-11-18', ctr: 0.05 }, { date: '2026-11-19', ctr: 0.03 }]);
    expect(t.sources[0]).toEqual({ type: 3, label: 'Browse features', impressions: 3000 });
    expect(t.endScreens).toMatchObject({ impressions: { value: 200 }, clicks: { value: 10 } });
  });
});

describe('videos, overview and earnings additions', () => {
  test('videos: share watched, impressions and the latest daily CTR', async () => {
    const { row, cookie } = await connected('rp-vids', 'UCrpvids');
    await env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-18', 'a', 300, 0.02, new Date(NOW).toISOString()).run();
    await env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-19', 'a', 200, 0.05, new Date(NOW).toISOString()).run();
    const { app } = setup({
      uploads: async () => [up('a', 'A'), up('b', 'B')],
      report: async (_t, q) => (q.dimensions?.[0] === 'day' ? daily
        : { columns: ['video', 'views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost', 'averageViewPercentage'], rows: [['a', 2000, 10, 10, 5, 1, 44.5]] }),
    });
    const v = await getJson<Videos>(app, `/api/channels/${row.id}/videos`, cookie);
    expect(v.videos[0]).toMatchObject({ averageViewPercentage: { value: 44.5 }, subscribersGained: { value: 5 }, impressions: { value: 500 }, latestCtr: { value: 0.05, inputs: { day: '2026-11-19' } } });
    expect(v.videos[0]).not.toHaveProperty('subscribersPer1000Views');
    expect(v.videos[1]!.impressions).toMatchObject({ kind: 'no_data' });
  });

  test('earnings: Premium revenue and countries, no RPM; a refused extra only empties its own part', async () => {
    const { row, cookie } = await connected('rp-earn', 'UCrpearn', true);
    const m = ['estimatedRevenue', 'playbackBasedCpm', 'monetizedPlaybacks'];
    const { app } = setup({
      report: async (_t, q) => {
        if (q.dimensions?.[0] === 'day') return daily;
        if (q.dimensions?.[0] === 'video') return { columns: ['video', 'estimatedRevenue', 'playbackBasedCpm'], rows: [] };
        if (q.dimensions?.[0] === 'country') return { kind: 'failed', reason: 'HTTP 400' };
        if (q.metrics.includes('estimatedRedPartnerRevenue')) return { columns: ['estimatedRedPartnerRevenue'], rows: [[3.5]] };
        return { columns: m, rows: [[50, 4, 1000]] };
      },
    });
    const e = await getJson<Earnings>(app, `/api/channels/${row.id}/earnings`, cookie);
    if (e.status !== 'ok') throw new Error(e.status);
    expect(e.totals).not.toHaveProperty('rpm');
    expect(e.totals.premiumRevenue.current).toMatchObject({ kind: 'value', value: 3.5 });
    expect(e.countries).toEqual([]);
    expect(e.countriesNote).toBe("YouTube didn't answer: HTTP 400");
  });
});

describe('audience page', () => {
  test('countries with names and shares, devices, age and gender, and what no API gives', async () => {
    const { row, cookie } = await connected('rp-aud', 'UCrpaud');
    const { app } = setup({
      report: async (_t, q) => {
        if (q.dimensions?.[0] === 'day') return daily;
        if (q.dimensions?.[0] === 'country') return { columns: ['country', 'views', 'estimatedMinutesWatched'], rows: [['US', 60, 100], ['DE', 20, 30]] };
        if (q.dimensions?.[0] === 'deviceType') return { columns: ['deviceType', 'views', 'estimatedMinutesWatched'], rows: [['MOBILE', 75, 1], ['DESKTOP', 25, 1]] };
        if (q.dimensions?.[0] === 'ageGroup') return { columns: ['ageGroup', 'gender', 'viewerPercentage'], rows: [['age25-34', 'female', 20], ['age25-34', 'male', 30], ['age25-34', 'user_specified', 1]] };
        return { columns: [], rows: [] };
      },
    });
    const a = await getJson<Audience>(app, `/api/channels/${row.id}/audience`, cookie);
    expect(a.countries[0]).toEqual({ key: 'US', label: 'United States', views: 60, watchMinutes: 100 });
    expect(a.devices.map((d) => [d.label, d.views])).toEqual([['Mobile phone', 75], ['Computer', 25]]);
    expect(a.ageGender).toEqual([{ ageGroup: '25–34', female: 20, male: 30, other: 1 }]);
    expect(a.notAvailable).toEqual(['Unique viewers', 'New vs returning viewers']);
  });
});

describe('video check-up', () => {
  const video = async (_t: string, id: string): Promise<VideoDetails> => ({ videoId: id, channelId: 'UCrpchk', title: 'Target', description: '', tags: [], publishedAt: '2026-10-01T00:00:00Z', durationSec: 300 });
  const cols = ['video', 'views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost', 'averageViewPercentage'];

  test("shows the video's YouTube values, with the channel's beside them where YouTube gives the same measure", async () => {
    const { row, cookie } = await connected('rp-chk', 'UCrpchk');
    const at = new Date(NOW).toISOString();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-18', 'targetVid01', 400, 0.03, at),
      env.DB.prepare('INSERT INTO reach_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-19', 'targetVid01', 600, 0.02, at),
      env.DB.prepare('INSERT INTO end_screen_daily VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, '2026-11-19', 'targetVid01', 50, 4, at),
    ]);
    const TOT = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost', 'averageViewPercentage'];
    const { app } = setup({
      video,
      uploads: async () => [up('targetVid01', 'Target'), up('otherVid001', 'O1')],
      report: async (_t, q: ReportQuery) => {
        if (q.dimensions?.[0] === 'day') return daily;
        if (q.dimensions?.[0] === 'video') return { columns: cols, rows: [['targetVid01', 1000, 1, 150, 10, 2, 60], ['otherVid001', 500, 1, 90, 2, 0, 40]] };
        if (q.dimensions?.[0] === 'elapsedVideoTimeRatio') return { columns: ['elapsedVideoTimeRatio', 'audienceWatchRatio', 'relativeRetentionPerformance'], rows: [[0.05, 0.7, 0.4], [0.1, 0.5, 0.3]] };
        if (q.dimensions?.[0] === 'insightTrafficSourceType') return { columns: ['insightTrafficSourceType', 'views', 'estimatedMinutesWatched'], rows: [['RELATED_VIDEO', 800, 1], ['YT_SEARCH', 200, 1]] };
        if (!q.dimensions) return { columns: TOT, rows: [[1500, 2, 120, 12, 2, 48]] };
        return { columns: [], rows: [] };
      },
    });
    const c = await getJson<VideoCheckup>(app, `/api/channels/${row.id}/checkup/targetVid01`, cookie);
    if (!c.parts) throw new Error(JSON.stringify(c));
    const val = (area: string, label: string) => c.parts.find((p) => p.area === area)!.values.find((v) => v.label.startsWith(label))!;
    expect(c.parts.map((p) => p.area)).toEqual(['Reach', 'Thumbnail & title', 'Opening', 'Watching', 'Subscribers', 'Next video']);
    expect(val('Reach', 'Thumbnail impressions').video).toMatchObject({ kind: 'value', value: 1000 });
    expect(val('Thumbnail & title', 'Click-through rate on 2026-11-19').video).toMatchObject({ value: 0.02 });
    // 0:30 of 300 s = 0.1: YouTube's point there, as given.
    expect(val('Opening', 'Still watching at 0:30').video).toMatchObject({ value: 0.5 });
    expect(val('Opening', "YouTube's score").video).toMatchObject({ value: 0.3 });
    expect(val('Watching', 'Average share watched')).toMatchObject({ video: { value: 60 }, channel: { value: 48 } });
    expect(val('Watching', 'Average view duration')).toMatchObject({ video: { value: 150 }, channel: { value: 120 } });
    expect(val('Subscribers', 'Subscribers gained').video).toMatchObject({ value: 10 });
    expect(val('Next video', 'End screen clicks').video).toMatchObject({ value: 4 });
    expect(c.ctrByDay).toEqual([{ date: '2026-11-18', ctr: 0.03 }, { date: '2026-11-19', ctr: 0.02 }]);
    expect(c.sources[0]).toMatchObject({ label: 'Suggested videos', views: 800 });
    expect(JSON.stringify(c)).not.toMatch(/median|verdict|share(Of)?Views/);
  });

  test("another channel's video is 404; a bad id is 400", async () => {
    const { row, cookie } = await connected('rp-chk2', 'UCrpchk2');
    const { app } = setup({ video });
    expect((await app.request(`/api/channels/${row.id}/checkup/abcdefghijk`, { headers: { cookie } })).status).toBe(404);
    expect((await app.request(`/api/channels/${row.id}/checkup/bad`, { headers: { cookie } })).status).toBe(400);
  });
});
