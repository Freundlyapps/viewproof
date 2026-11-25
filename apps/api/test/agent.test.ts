import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { ChannelRow } from '@viewproof/db';
import { parseBrief } from '../src/agent/brief';
import { runAgentCron } from '../src/agent/checks';
import { createApp } from '../src/app';
import type { ReportQuery, Upload, VideoDetails, YouTubeClient } from '../src/youtube';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { channelFixture, fakeLlm, makeDeps, post, sendJsonReq, signIn } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const DAY = 86_400_000;

describe('parseBrief', () => {
  const cands = [{ ref: 'V1', videoId: 'aaaaaaaaaaa', title: 'Old title', publishedAt: '2026-07-01T00:00:00Z' }];
  const known = new Set(['S1', 'S2']);
  const src = '"glaze mistakes" — 640 views\nV1: "Old title" — 50 views in the last 28 days';
  test('drops reasons with numbers the data lacks, unknown videos, same or bad titles; caps ideas at 5', () => {
    const text = JSON.stringify({
      ideas: [
        ...Array.from({ length: 6 }, (_, i) => ({ text: `Idea ${i}`, why: 'Your term "glaze mistakes" got 640 views', sources: ['S1', 'S9'] })),
        { text: 'Made up', why: 'This got 47,000 views last week', sources: ['S1'] },
      ],
      changes: [
        { video: 'V1', title: 'Glaze Mistakes Beginners Make', why: 'It gets 50 views; the term has 640', sources: ['S2'] },
        { video: 'V1', title: 'A second one for the same video', why: 'x', sources: [] },
        { video: 'V9', title: 'Unknown video', why: 'x', sources: [] },
      ],
    });
    const r = parseBrief(`Sure!\n\`\`\`json\n${text}\n\`\`\``, known, cands, src)!;
    expect(r.ideas).toHaveLength(5);
    expect(r.ideas[0]!.sources).toEqual(['S1']);
    expect(r.dropped).toBe(1);
    expect(r.changes).toEqual([{ video: 'V1', title: 'Glaze Mistakes Beginners Make', why: 'It gets 50 views; the term has 640', sources: ['S2'] }]);
  });
  test('same title (any case), over 100 characters or with < > is not a change', () => {
    for (const title of ['old TITLE', 'x'.repeat(101), 'Pots <b>now</b>']) {
      expect(parseBrief(JSON.stringify({ ideas: [{ text: 'A', why: '' }], changes: [{ video: 'V1', title, why: '' }] }), known, cands, src)!.changes).toEqual([]);
    }
  });
  test('a change with an invented number in its reason is dropped and counted', () => {
    const r = parseBrief(JSON.stringify({ ideas: [], changes: [{ video: 'V1', title: 'New', why: 'Titles like this get 3x more views' }] }), known, cands, src);
    expect(r).toBeNull();
  });
  test('garbage → null', () => {
    expect(parseBrief('no json here', known, cands, src)).toBeNull();
    expect(parseBrief('{"ideas": [], "changes": []}', known, cands, src)).toBeNull();
  });
});

const up = (videoId: string, title: string, publishedAt: string): Upload => ({ videoId, title, publishedAt, durationSec: 600, views: 1000, thumbnailUrl: null });
const UPLOADS = [
  up('vidAAAAAAAA', 'Glazing at home', '2026-09-01T10:00:00Z'),
  up('vidBBBBBBBB', 'Trimming bowls', '2026-08-01T10:00:00Z'),
  up('vidCCCCCCCC', 'Studio tour', '2026-07-01T10:00:00Z'),
  up('vidDDDDDDDD', 'Centering clay', '2026-06-01T10:00:00Z'),
];
const VIEWS28: Record<string, number> = { vidAAAAAAAA: 900, vidBBBBBBBB: 100, vidCCCCCCCC: 50, vidDDDDDDDD: 2000 };

/** Fake YouTube with the reports the brief and the measurement ask for. `live` is the title YouTube returns now. */
function youtubeFor(o: { live?: () => string; daily?: (date: string) => [number, number]; channelId?: string } = {}): Partial<YouTubeClient> {
  return {
    uploads: async () => UPLOADS,
    video: async (_t, id) => ({ videoId: id, channelId: o.channelId ?? 'UCagent', title: o.live?.() ?? UPLOADS.find((u) => u.videoId === id)?.title ?? '', description: '', tags: [], publishedAt: '2026-07-01T10:00:00Z', durationSec: 600 } satisfies VideoDetails),
    report: async (_t: string, q: ReportQuery) => {
      const dims = q.dimensions?.join(',') ?? '';
      if (dims === 'day') return { columns: ['day', 'views'], rows: [['2026-11-18', 40]] };
      if (dims === 'video') return { columns: ['video', 'views', 'estimatedMinutesWatched', 'averageViewDuration'], rows: Object.entries(VIEWS28).map(([v, n]) => [v, n, n, 200]) };
      if (dims === 'insightTrafficSourceDetail') return { columns: ['insightTrafficSourceDetail', 'views', 'estimatedMinutesWatched'], rows: q.filters?.includes('video==') ? [['studio tour ideas', 12, 3]] : [['glaze mistakes', 640, 100]] };
      if (dims === 'day,insightTrafficSourceType') {
        const rows: (string | number)[][] = [];
        for (let t = Date.parse(`${q.startDate}T00:00:00Z`); t <= Date.parse(`${q.endDate}T00:00:00Z`); t += DAY) {
          const d = new Date(t).toISOString().slice(0, 10);
          const [search, other] = o.daily?.(d) ?? [4, 6];
          rows.push([d, 'YT_SEARCH', search], [d, 'SUBSCRIBER', other]);
        }
        return { columns: ['day', 'insightTrafficSourceType', 'views'], rows };
      }
      return { columns: ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost'], rows: [[3000, 9000, 180, 20, 2]] };
    },
  };
}

const BRIEF_REPLY = JSON.stringify({
  ideas: [
    { text: 'Five glaze mistakes', why: 'Your search term "glaze mistakes" brought 640 views', sources: ['S3'] },
    { text: 'Invented', why: 'Videos like this average 47,000 views', sources: ['S1'] },
    { text: 'Studio tour 2', why: 'Viewers search for studio tour ideas', sources: ['S6'] },
  ],
  changes: [{ video: 'V1', title: 'My Pottery Studio Tour (Small Space Ideas)', why: 'It found 12 views from "studio tour ideas"', sources: ['S6'] }],
});

async function setup(o: { plan?: string; reply?: () => string; yt?: Parameters<typeof youtubeFor>[0]; now?: () => number } = {}) {
  const sub = `agent-${Math.random().toString(36).slice(2, 8)}`;
  const s = await signIn({ sub, channel: channelFixture({ channelId: `UC${sub}` }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(`UC${sub}`).first<ChannelRow>())!;
  await env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(o.plan ?? 'pro', row.user_id).run();
  const f = fakeLlm(() => (o.reply ?? (() => BRIEF_REPLY))());
  let clock = o.now ?? (() => NOW);
  const youtube = fakeYouTube(youtubeFor({ ...o.yt, channelId: `UC${sub}` }));
  const deps = () => makeDeps({ youtube, llm: f.llm, google: fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) }), now: () => clock() }, { AI_API_KEY: 'sk-included' } as never);
  return {
    cookie: s.cookie, row, f, youtube,
    app: () => createApp(deps()),
    cron: (at: number) => { clock = () => at; return runAgentCron(deps(), new Date(at)); },
    setNow: (at: number) => { clock = () => at; },
  };
}
const q1 = <T>(sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).first<T>();

describe('POST /api/agent/brief', () => {
  test('stores ideas and code-chosen title changes; drops invented numbers; counts use and tokens', async () => {
    const s = await setup();
    const res = await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie);
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.brief.ideas.map((i: any) => i.text)).toEqual(['Five glaze mistakes', 'Studio tour 2']);
    expect(b.brief.dropped).toBe(1);
    expect(b.brief.ai).toMatchObject({ model: 'claude-sonnet-5-5', via: 'included' });
    expect(b.brief.sources.at(-1)).toMatchObject({ kind: 'candidates' });
    // Candidates: below the median of settled videos (500), lowest first: Studio tour (50) = V1, Trimming bowls (100) = V2.
    expect(b.brief.sources.at(-1).lines[1]).toContain('V1: "Studio tour" — 50 views in the last 28 days');
    expect(b.changes).toHaveLength(1);
    expect(b.changes[0]).toMatchObject({ videoId: 'vidCCCCCCCC', beforeTitle: 'Studio tour', proposedTitle: 'My Pottery Studio Tour (Small Space Ideas)', status: 'proposed' });
    expect(b.usage).toEqual({ used: 1, limit: 6 });
    expect(s.f.requests[0]!.model).toBe('claude-sonnet-5-5');
    const tok = await q1<{ runs: number; input_tokens: number }>("SELECT SUM(runs) AS runs, SUM(input_tokens) AS input_tokens FROM ai_tokens WHERE task = 'brief' AND model = 'claude-sonnet-5-5'");
    expect(tok!.runs).toBeGreaterThanOrEqual(1);
  });

  test('AI_BRIEF_MODEL chooses the decision model', async () => {
    const s = await setup();
    const f = fakeLlm(() => BRIEF_REPLY);
    const app = createApp(makeDeps({ youtube: fakeYouTube(youtubeFor({ channelId: s.row.channel_id })), llm: f.llm, google: fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) }), now: () => NOW }, { AI_API_KEY: 'sk', AI_BRIEF_MODEL: 'my-brief-model' } as never));
    expect((await sendJsonReq(app, 'POST', '/api/agent/brief', s.cookie)).status).toBe(200);
    expect(f.requests[0]!.model).toBe('my-brief-model');
  });

  test('Free plan without an own key: refused with the way forward, nothing sent to the AI', async () => {
    const s = await setup({ plan: 'free' });
    const res = await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie);
    expect(res.status).toBe(402);
    expect(((await res.json()) as any).message).toMatch(/weekly brief is included with Pro/);
    expect(s.f.requests).toHaveLength(0);
  });

  test('an unusable answer is not counted', async () => {
    const s = await setup({ reply: () => 'Sorry, I cannot help.' });
    const res = await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie);
    expect(res.status).toBe(502);
    expect((await q1<{ brief: number }>('SELECT brief FROM ai_usage WHERE user_id = ?', s.row.user_id))?.brief ?? 0).toBe(0);
  });

  test('a new brief expires suggestions never acted on; videos with an approved change get no new one', async () => {
    const s = await setup();
    const first = await (await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie)).json() as any;
    const id = first.changes[0].id;
    await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie);
    expect((await q1<{ status: string }>('SELECT status FROM agent_changes WHERE id = ?', id))!.status).toBe('expired');
    const open = await q1<{ id: string }>("SELECT id FROM agent_changes WHERE user_id = ? AND status = 'proposed'", s.row.user_id);
    await sendJsonReq(s.app(), 'POST', `/api/agent/changes/${open!.id}`, s.cookie, { action: 'approve' });
    const third = await (await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie)).json() as any;
    // Studio tour is busy now, so V1 is Trimming bowls; the AI's "V1" change goes to that video.
    expect(third.brief.sources.at(-1).lines[1]).toContain('V1: "Trimming bowls"');
  });
});

describe('approve → live → measured', () => {
  test('approve; the hourly job sees the new title live, then measures after 7 days', async () => {
    let live = 'Studio tour';
    // Before: 10 views a day (4 search). After the change: 20 a day (12 search).
    const s = await setup({ yt: { live: () => live, daily: (d) => (d >= '2026-11-22' ? [12, 8] : [4, 6]) } });
    const b = await (await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie)).json() as any;
    const id = b.changes[0].id;
    const other = await setup();
    expect((await sendJsonReq(other.app(), 'POST', `/api/agent/changes/${id}`, other.cookie, { action: 'approve' })).status).toBe(409);
    expect((await sendJsonReq(s.app(), 'POST', `/api/agent/changes/${id}`, s.cookie, { action: 'approve' })).status).toBe(200);

    await s.cron(NOW); // title unchanged
    expect((await q1<{ status: string }>('SELECT status FROM agent_changes WHERE id = ?', id))!.status).toBe('approved');

    live = 'My Pottery Studio Tour (Small Space Ideas)';
    const NEXT = NOW + DAY; // 2026-11-22 Pacific
    await s.cron(NEXT);
    let row = (await q1<any>('SELECT * FROM agent_changes WHERE id = ?', id))!;
    expect(row).toMatchObject({ status: 'applied', applied_on: '2026-11-22', applied_title: live, check7: null });

    await s.cron(NEXT + 7 * DAY); // after period ends 11-28; YouTube lags ~2 days, so not asked before 11-30
    row = (await q1<any>('SELECT * FROM agent_changes WHERE id = ?', id))!;
    expect(row.check7).toBeNull();
    await s.cron(NEXT + 8 * DAY);
    row = (await q1<any>('SELECT * FROM agent_changes WHERE id = ?', id))!;
    const m = JSON.parse(row.check7);
    expect(m).toMatchObject({ state: 'measured', days: 7, applied: '2026-11-22', afterEnd: '2026-11-28' });
    expect(m.views).toMatchObject({ before: 70, after: 140, changePct: 100, usualSwingPct: 0, verdict: 'above_swing' });
    expect(m.searchViews).toMatchObject({ before: 28, after: 84, verdict: 'above_swing' });
    expect(row.check28).toBeNull();
    const query = s.youtube.calls.filter((c) => c.method === 'report').map((c) => c.arg as ReportQuery).find((x) => x.dimensions?.join(',') === 'day,insightTrafficSourceType')!;
    expect(query).toMatchObject({ startDate: '2026-09-27', endDate: '2026-11-28', filters: 'video==vidCCCCCCCC' });
  });

  test('dismiss; an approved title that never goes live expires after 30 days', async () => {
    const s = await setup();
    const b = await (await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie)).json() as any;
    const id = b.changes[0].id;
    await sendJsonReq(s.app(), 'POST', `/api/agent/changes/${id}`, s.cookie, { action: 'approve' });
    await s.cron(NOW + 31 * DAY);
    expect((await q1<{ status: string }>('SELECT status FROM agent_changes WHERE id = ?', id))!.status).toBe('expired');
    expect((await sendJsonReq(s.app(), 'POST', `/api/agent/changes/${id}`, s.cookie, { action: 'dismiss' })).status).toBe(409);
  });
});

describe('weekly briefs (hourly job)', () => {
  test('only when switched on; once a week; a failure waits a day', async () => {
    const s = await setup();
    await s.cron(NOW);
    expect(s.f.requests).toHaveLength(0);
    await sendJsonReq(s.app(), 'POST', '/api/agent/settings', s.cookie, { weekly: true });
    await s.cron(NOW);
    expect(s.f.requests).toHaveLength(1);
    expect((await q1<{ trigger: string }>('SELECT trigger FROM agent_briefs WHERE user_id = ?', s.row.user_id))!.trigger).toBe('weekly');
    await s.cron(NOW + 3_600_000);
    expect(s.f.requests).toHaveLength(1);
    await s.cron(NOW + 7 * DAY + 3_600_000);
    expect(s.f.requests).toHaveLength(2);
  });

  test('a failed weekly run records why and is not retried for a day', async () => {
    const s = await setup({ reply: () => 'nope' });
    await sendJsonReq(s.app(), 'POST', '/api/agent/settings', s.cookie, { weekly: true });
    await s.cron(NOW);
    await s.cron(NOW + 3_600_000);
    expect(s.f.requests).toHaveLength(1);
    const st = await (await s.app().request('/api/agent', { headers: { cookie: s.cookie } })).json() as any;
    expect(st.settings.lastError).toMatch(/couldn't be used/);
    await s.cron(NOW + DAY + 3_600_000);
    expect(s.f.requests).toHaveLength(2);
  });
});

describe('agent data lifetime', () => {
  test('briefs deleted after 30 days; removing the channel deletes its briefs and changes; export includes them', async () => {
    const s = await setup();
    await sendJsonReq(s.app(), 'POST', '/api/agent/brief', s.cookie);
    const exp = await (await s.app().request('/account/export', { headers: { cookie: s.cookie } })).json() as any;
    expect(exp.agent.briefs).toHaveLength(1);
    expect(exp.agent.changes[0]).toMatchObject({ video_id: 'vidCCCCCCCC', status: 'proposed' });
    await s.cron(NOW + 31 * DAY);
    expect(await q1('SELECT id FROM agent_briefs WHERE user_id = ?', s.row.user_id)).toBeNull();
    expect(await q1('SELECT id FROM agent_changes WHERE user_id = ?', s.row.user_id)).not.toBeNull();
  });
});
