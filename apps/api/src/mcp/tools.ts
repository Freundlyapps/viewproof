// Read-only MCP tools (plan 6c). Each tool calls the same loaders as the web app, through the same report cache.
import { type OptimizeVideo, type Overview, RANGES, type SearchTerms, type TrafficSources, type UploadTimes, type VideoRetention, type Videos, type Audience, type Thumbnails, type VideoCheckup, checkDescription, checkTags, checkTitle, normalizeKeyword } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import type { Deps } from '../app';
import { ownedChannel } from '../channel-data';
import { latestUploads } from '../competitors/routes';
import { findOutliers, parseOutlierQuery } from '../pool/outliers';
import { VIDEO_ID, channelReport, loadOptimize, loadOverview, loadSearchTerms, loadUploadTimes, loadVideos, today } from '../routes/channel';
import { loadAudience, loadCheckup, loadRetention, loadTrafficSources } from '../routes/insights';
import { loadThumbnails } from '../reporting/read';
import { MAX_KEYWORD, keywordTrends } from '../routes/keywords';

type Kind = 'string' | 'number' | 'string[]';
interface Param { name: string; kind: Kind; description: string; required?: boolean; enum?: readonly (string | number)[]; min?: number; max?: number }
type Args = Record<string, unknown>;
/** A tool's answer: data for the model, or an error message for it (isError). */
export type ToolOutcome = { data: Record<string, unknown> } | { error: string };
interface Ctx { deps: Deps; userId: string }
interface Tool { name: string; title: string; description: string; params: Param[]; run(ctx: Ctx, a: Args): Promise<ToolOutcome> }

const CHANNEL: Param = { name: 'channel', kind: 'string', description: 'Channel id from list_channels. Default: your first connected channel.' };
const RANGE: Param = { name: 'range', kind: 'string', enum: RANGES, description: 'Period: last 7, 28, 90 or 365 days. Default 28d.' };
export const NOT_THIS_CHANNEL = 'Video not found on this channel.';
const BAD_VIDEO_ID = 'That is not a YouTube video id.';

async function channelFor(ctx: Ctx, id: unknown): Promise<ChannelRow | string> {
  if (typeof id === 'string') {
    return (await ownedChannel(ctx.deps, ctx.userId, id)) ?? 'No connected channel with that id. Call list_channels for your channel ids.';
  }
  const first = await ctx.deps.db.prepare("SELECT * FROM channels WHERE user_id = ? AND status != 'gone' ORDER BY connected_at LIMIT 1").bind(ctx.userId).first<ChannelRow>();
  return first ?? `No channel is connected yet. Connect one at ${ctx.deps.config.appOrigin}/app/settings.`;
}

/** A cached channel report (same keys as the web routes), or the real reason it isn't available. */
function report<T extends object>(key: (a: Args, day: string) => string, load: (deps: Deps, a: Args) => Parameters<typeof channelReport<T>>[3]) {
  return async (ctx: Ctx, a: Args): Promise<ToolOutcome> => {
    const ch = await channelFor(ctx, a.channel);
    if (typeof ch === 'string') return { error: ch };
    const r = await channelReport<T>(ctx.deps, ch, key(a, today(ctx.deps)), load(ctx.deps, a));
    return 'reason' in r && typeof (r as { reason?: unknown }).reason === 'string' && Object.keys(r).length === 1 ? { error: (r as { reason: string }).reason } : { data: r as Record<string, unknown> };
  };
}
const range = (a: Args) => (a.range as (typeof RANGES)[number] | undefined) ?? '28d';
/** Said in the search_terms answer itself, so a chat app can't take the terms for the whole traffic picture. */
export const SEARCH_TERMS_SCOPE = "Only views that came from YouTube search, and only YouTube's top 25 terms: the terms don't add up to all search views, and search is one traffic source among others (call traffic_sources for the split).";
const VIDEO_ID_PARAM: Param = { name: 'videoId', kind: 'string', required: true, description: '11-character YouTube video id of one of your videos.' };

export const TOOLS: Tool[] = [
  {
    name: 'list_channels', title: 'Your channels', params: [],
    description: "The creator's connected YouTube channels with their ids and connection status.",
    run: async (ctx) => {
      const rows = (await ctx.deps.db.prepare('SELECT * FROM channels WHERE user_id = ? ORDER BY connected_at').bind(ctx.userId).all<ChannelRow>()).results;
      return { data: { channels: rows.map((r) => ({ id: r.id, title: r.title, youtubeChannelId: r.channel_id, status: r.status, statusReason: r.status_reason })) } };
    },
  },
  {
    name: 'channel_overview', title: 'Channel overview', params: [CHANNEL, RANGE],
    description: 'Views, watch time, average view duration, average share watched (averageViewPercentage, 0–100) and subscribers gained and lost for a period, compared with the period before, from YouTube Analytics.',
    run: report<Overview>((a, d) => `overview:${range(a)}:${d}`, (_d, a) => (deps, acc) => loadOverview(deps, acc, range(a))),
  },
  {
    name: 'channel_videos', title: 'Channel videos', params: [CHANNEL, RANGE],
    description: "The channel's videos with, for the period: views, watch time, average view duration, average share watched and subscribers gained and lost (YouTube Analytics), plus thumbnail impressions summed over the days ViewProof has and YouTube's click-through rate for the latest day (YouTube Reporting API, last 30 days at most).",
    run: report<Videos>((a, d) => `videos:${range(a)}:${d}`, (_d, a) => (deps, acc) => loadVideos(deps, acc, range(a))),
  },
  {
    name: 'search_terms', title: 'Search terms', params: [CHANNEL, RANGE],
    description: "The top 25 terms people typed in YouTube search before watching the channel, or YouTube's note when it withholds them. Covers YouTube search traffic only, not all traffic: for the split between search, Browse, Suggested, Shorts feed and other sources, call traffic_sources.",
    run: async (ctx, a) => {
      const r = await report<SearchTerms>((a2, d) => `terms:${range(a2)}:${d}`, (_d, a2) => (deps, acc) => loadSearchTerms(deps, acc, range(a2)))(ctx, a);
      return 'data' in r ? { data: { scope: SEARCH_TERMS_SCOPE, ...r.data } } : r;
    },
  },
  {
    name: 'traffic_sources', title: 'Traffic sources', params: [CHANNEL, RANGE],
    description: "Where the channel's views came from in the period (YouTube search, Browse features, Suggested videos, Shorts feed, External, …): views and watch time per source, with the period before. From YouTube Analytics. For thumbnail impressions and click-through rate, call thumbnails.",
    run: report<TrafficSources>((a, d) => `traffic:${range(a)}:${d}`, (_d, a) => (deps, acc) => loadTrafficSources(deps, acc, range(a))),
  },
  {
    name: 'upload_times', title: 'Upload times', params: [CHANNEL],
    description: 'Recent uploads with their publish time and first-week views, for judging when to post.',
    run: report<UploadTimes>((_a, d) => `upload-times:${d}`, () => (deps, acc) => loadUploadTimes(deps, acc)),
  },
  {
    name: 'video_details', title: 'Video details', params: [VIDEO_ID_PARAM, CHANNEL],
    description: "One of the creator's videos: title, description, tags and the video's own real search terms (last 90 days).",
    run: async (ctx, a) => {
      const id = a.videoId as string;
      if (!VIDEO_ID.test(id)) return { error: BAD_VIDEO_ID };
      const r = await report<OptimizeVideo | { missing: true }>((_a, d) => `optimize:${id}:${d}`, () => (deps, acc) => loadOptimize(deps, acc, id))(ctx, a);
      return 'data' in r && 'missing' in r.data ? { error: NOT_THIS_CHANNEL } : r;
    },
  },
  {
    name: 'audience', title: 'Audience', params: [CHANNEL, RANGE],
    description: "Who watches: top countries and devices with their views, and age and gender (YouTube's viewerPercentage of signed-in viewers), from YouTube Analytics. `notAvailable` lists what YouTube gives no app (unique and returning viewers).",
    run: report<Audience>((a, d) => `audience:${range(a)}:${d}`, (_d, a) => (deps, acc) => loadAudience(deps, acc, range(a))),
  },
  {
    name: 'thumbnails', title: 'Thumbnail impressions and clicks', params: [CHANNEL, RANGE],
    description: "Thumbnail impressions (summed per day, per video and per traffic source) and YouTube's click-through rate per video per day as given (0–1), plus end screen impressions and clicks, from the YouTube Reporting API. ViewProof keeps only the last 30 days, so `days` says which days are covered; `status` waiting means the reports just started (about two days).",
    run: report<Thumbnails>((a, d) => `thumbs:${range(a)}:${d}`, (_d, a) => (deps, acc) => loadThumbnails(deps, acc, range(a))),
  },
  {
    name: 'video_checkup', title: 'Video check-up',
    params: [VIDEO_ID_PARAM, CHANNEL, RANGE],
    description: "One video's YouTube values in six parts (reach, thumbnail & title, opening at 0:30 with YouTube's score against similar-length videos, share watched, subscribers, end screen), with the channel's value beside it where YouTube gives the same measure, and fixed guidance on what to look for. Also the retention curve, the daily click-through rate and the video's traffic sources.",
    run: async (ctx, a) => {
      const id = a.videoId as string;
      if (!VIDEO_ID.test(id)) return { error: BAD_VIDEO_ID };
      const r = await report<VideoCheckup | { missing: true }>((a2, d) => `checkup:${id}:${range(a2)}:${d}`, (_d, a2) => (deps, acc) => loadCheckup(deps, acc, id, range(a2)))(ctx, a);
      return 'data' in r && 'missing' in r.data ? { error: NOT_THIS_CHANNEL } : r;
    },
  },
  {
    name: 'video_retention', title: 'Video retention',
    params: [VIDEO_ID_PARAM, CHANNEL, { name: 'range', kind: 'string', enum: RANGES, description: 'Period: last 7, 28, 90 or 365 days. Default 90d (retention needs enough views).' }],
    description: "One of the creator's videos: its audience retention curve (up to 100 points by share of the video's length; audienceWatchRatio = viewers still watching ÷ views, above 1 where people rewatch), YouTube's comparison with similar-length videos, and YouTube's first point at or after 0:30 (at30s). From YouTube Analytics.",
    run: async (ctx, a) => {
      const id = a.videoId as string;
      if (!VIDEO_ID.test(id)) return { error: BAD_VIDEO_ID };
      const rg = (a.range as (typeof RANGES)[number] | undefined) ?? '90d';
      const r = await report<VideoRetention | { missing: true }>((_a, d) => `retention:${id}:${rg}:${d}`, () => (deps, acc) => loadRetention(deps, acc, id, rg))(ctx, a);
      return 'data' in r && 'missing' in r.data ? { error: NOT_THIS_CHANNEL } : r;
    },
  },
  {
    name: 'find_outliers', title: 'Find outliers',
    params: [
      { name: 'q', kind: 'string', description: 'Keyword the title must contain. Default: any.' },
      { name: 'days', kind: 'number', enum: [7, 30, 90, 365], description: 'Published within the last N days. Default 30.' },
      { name: 'min', kind: 'number', enum: [1.5, 2, 3, 5, 10], description: "Minimum ×N against the channel's usual views. Default 2." },
      { name: 'format', kind: 'string', enum: ['any', 'long', 'short'], description: 'Video format. Default any.' },
      { name: 'size', kind: 'string', enum: ['any', 'small', 'medium', 'large'], description: 'Channel size by median views (small < 10k, medium < 100k). Default any.' },
    ],
    description: "Videos beating their channel's usual views (×N), from videos ViewProof's network observed — not all of YouTube. `coverage` describes the network's pool (videos seen in its last `coverage.days` days), not the `days` filter, which applies to the rows.",
    run: async (ctx, a) => {
      const u = new URLSearchParams();
      for (const k of ['q', 'days', 'min', 'format', 'size']) if (a[k] !== undefined) u.set(k, String(a[k]));
      return { data: (await findOutliers(ctx.deps, parseOutlierQuery(u))) as unknown as Record<string, unknown> };
    },
  },
  {
    name: 'competitor_uploads', title: 'Competitor uploads', params: [{ name: 'max', kind: 'number', min: 1, max: 50, description: 'How many recent uploads. Default 20.' }],
    description: "Latest uploads of the competitors the creator tracks, with views and ×N where known.",
    run: async (ctx, a) => ({ data: { uploads: await latestUploads(ctx.deps, ctx.userId, (a.max as number | undefined) ?? 20) } }),
  },
  {
    name: 'keyword_trends', title: 'Keyword trends',
    params: [{ name: 'keyword', kind: 'string', required: true, description: `Keyword (up to ${MAX_KEYWORD} characters).` }, { name: 'country', kind: 'string', description: 'Two-letter country code. Default US.' }],
    description: 'Relative YouTube search interest for a keyword over time (an estimate from a licensed vendor), when the server has one configured.',
    run: async (ctx, a) => {
      const q = normalizeKeyword(a.keyword as string);
      if (!q || q.length > MAX_KEYWORD) return { error: `Invalid arguments: keyword must have 1 to ${MAX_KEYWORD} characters` };
      const r = await keywordTrends(ctx.deps, ctx.userId, q, (a.country as string | undefined) ?? '');
      return 'limit' in r ? { error: r.limit } : { data: r as unknown as Record<string, unknown> };
    },
  },
  {
    name: 'check_video_text', title: 'Check title, description and tags',
    params: [
      { name: 'title', kind: 'string', required: true, description: 'Video title.' },
      { name: 'description', kind: 'string', description: 'Video description.' },
      { name: 'tags', kind: 'string[]', description: 'Tags.' },
      { name: 'keyword', kind: 'string', description: 'Main keyword.' },
      { name: 'lengthSec', kind: 'number', min: 0, description: 'Video length in seconds; chapters are checked only when given.' },
    ],
    description: "ViewProof's rule-based checks (length, keyword position, chapters, tag limits). Each rule states its threshold; no score.",
    run: async (_ctx, a) => {
      const kw = typeof a.keyword === 'string' && a.keyword.trim() ? a.keyword : null;
      const data: Record<string, unknown> = { title: checkTitle(a.title as string, kw) };
      if (typeof a.description === 'string') {
        const d = checkDescription(a.description, kw, (a.lengthSec as number | undefined) ?? 0);
        data.description = a.lengthSec === undefined ? d.filter((c) => c.id !== 'chapters') : d;
      }
      if (Array.isArray(a.tags)) data.tags = checkTags(a.tags as string[]);
      return { data };
    },
  },
];

export function inputSchema(t: Tool) {
  const properties: Record<string, unknown> = {};
  for (const p of t.params) {
    const base = p.kind === 'string[]' ? { type: 'array', items: { type: 'string' } } : { type: p.kind };
    properties[p.name] = { ...base, description: p.description, ...(p.enum ? { enum: p.enum } : {}), ...(p.min !== undefined ? { minimum: p.min } : {}), ...(p.max !== undefined ? { maximum: p.max } : {}) };
  }
  return { type: 'object', properties, required: t.params.filter((p) => p.required).map((p) => p.name), additionalProperties: false };
}

/** Checks arguments against the tool's params; the message names the first bad field. */
export function validate(t: Tool, raw: unknown): Args | string {
  const a = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Args;
  const bad = (name: string, why: string) => `Invalid arguments: ${name} ${why}`;
  for (const k of Object.keys(a)) if (!t.params.some((p) => p.name === k)) return bad(k, 'is not a parameter of this tool');
  for (const p of t.params) {
    const v = a[p.name];
    if (v === undefined || v === null) {
      if (p.required) return bad(p.name, 'is required');
      delete a[p.name];
      continue;
    }
    if (p.kind === 'string' && (typeof v !== 'string' || (p.required && !v.trim()))) return bad(p.name, 'must be a non-empty text');
    if (p.kind === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) return bad(p.name, 'must be a number');
    if (p.kind === 'string[]' && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) return bad(p.name, 'must be a list of texts');
    if (p.enum && !p.enum.includes(v as string | number)) return bad(p.name, `must be one of ${p.enum.join(', ')}`);
    if (p.min !== undefined && (v as number) < p.min) return bad(p.name, `must be at least ${p.min}`);
    if (p.max !== undefined && (v as number) > p.max) return bad(p.name, `must be at most ${p.max}`);
  }
  return a;
}
