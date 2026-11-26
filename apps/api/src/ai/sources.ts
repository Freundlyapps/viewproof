// The numbered sources an AI answer may use (spec §8 item 6: "each answer states which data it used").
// Only data the app already has: cached YouTube Analytics reports, stored competitor feeds, the pool.
import type { Measured, Overview, SearchTerms, Videos } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import type { Deps } from '../app';
import { ownedChannel } from '../channel-data';
import { latestUploads } from '../competitors/routes';
import { findOutliers } from '../pool/outliers';
import { channelReport, loadOverview, loadSearchTerms, loadVideos, today } from '../routes/channel';

export type SourceKind = 'channel' | 'videos' | 'terms' | 'competitors' | 'outliers' | 'candidates';
export interface AiSource { id: string; kind: SourceKind; label: string; detail: string; provenance: 'real' | 'public' | 'pool'; lines: string[] }
export interface Missing { kind: SourceKind; label: string; reason: string }

const MAX_LINES = 25;
const LABELS: Record<SourceKind, { label: string; detail: string; provenance: AiSource['provenance'] }> = {
  channel: { label: 'Your channel, last 28 days', detail: 'YouTube Analytics', provenance: 'real' },
  videos: { label: 'Your top videos, last 90 days', detail: 'YouTube Analytics', provenance: 'real' },
  terms: { label: 'Your real search terms, last 90 days', detail: 'YouTube Analytics', provenance: 'real' },
  competitors: { label: "Tracked competitors' latest uploads", detail: 'public RSS feeds', provenance: 'public' },
  outliers: { label: 'Outliers our network observed, last 30 days', detail: 'ViewProof data pool', provenance: 'pool' },
  candidates: { label: 'Your videos below your usual, last 28 days', detail: 'YouTube Analytics', provenance: 'real' },
};
export const SOURCE_LABELS = LABELS;
const NO_CHANNEL = 'No channel connected';

const num = (n: number) => Math.round(n).toLocaleString('en-US');
const views = (n: number) => `${num(n)} ${Math.round(n) === 1 ? 'view' : 'views'}`;
const val = (m: Measured<number> | undefined) => (m && m.kind === 'value' ? m.value : null);
const date = (iso: string) => iso.slice(0, 10);

/** One safe line: no newlines or control/bidi characters, at most `max` characters. */
export function flatten(s: string, max = 160): string {
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const attr = (s: string) => flatten(s, 80).replace(/["<>]/g, '');

/** Sources as tagged data blocks for the prompt; a line can't close its tag. */
export function sourceBlock(sources: AiSource[]): string {
  return sources
    .map((s) => `<source id="${s.id}" label="${attr(s.label)}" from="${attr(s.detail)}">\n${s.lines.map((l) => l.replace(/<\/?source/gi, '‹source')).join('\n')}\n</source>`)
    .join('\n\n');
}

function channelLines(o: Overview): string[] {
  const t = o.totals;
  const v = val(t.views.current);
  const minutes = val(t.watchMinutes.current);
  const avd = val(t.averageViewDuration.current);
  const gained = val(t.subscribersGained.current);
  const lost = val(t.subscribersLost.current);
  const out: string[] = [];
  if (v !== null) out.push(views(v));
  if (minutes !== null) out.push(`${num(minutes / 60)} watch hours`);
  if (avd !== null) {
    const sec = Math.round(avd);
    out.push(`average view duration ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  }
  if (gained !== null && lost !== null) out.push(`${num(gained - lost)} net subscribers (${num(gained)} gained, ${num(lost)} lost)`);
  if (o.dataThrough) out.push(`data through ${o.dataThrough}`);
  return out;
}

function videoLines(v: Videos): string[] {
  return [...v.videos]
    .filter((r) => val(r.views) !== null)
    .sort((a, b) => val(b.views)! - val(a.views)!)
    .slice(0, 15)
    .map((r) => {
      const avd = val(r.averageViewDuration);
      const pct = avd !== null && r.durationSec ? `, ${Math.round((avd / r.durationSec) * 100)}% average viewed` : '';
      return flatten(`"${flatten(r.title, 100)}" — ${views(val(r.views)!)}${pct}, published ${date(r.publishedAt)}`);
    });
}

const termLines = (t: SearchTerms) => t.terms.slice(0, MAX_LINES).map((x) => flatten(`"${flatten(x.term, 100)}" — ${views(x.views)}`));

async function firstChannel(deps: Deps, userId: string, channelRowId: string | null): Promise<ChannelRow | null> {
  if (channelRowId) return ownedChannel(deps, userId, channelRowId);
  return deps.db.prepare("SELECT * FROM channels WHERE user_id = ? AND status != 'gone' ORDER BY connected_at LIMIT 1").bind(userId).first<ChannelRow>();
}

export async function gatherSources(deps: Deps, userId: string, kinds: SourceKind[], channelRowId: string | null): Promise<{ sources: AiSource[]; missing: Missing[] }> {
  const ch = kinds.some((k) => k === 'channel' || k === 'videos' || k === 'terms') ? await firstChannel(deps, userId, channelRowId) : null;
  const day = today(deps);

  const linesFor = async (kind: SourceKind): Promise<string[] | string> => {
    try {
      switch (kind) {
        case 'channel': {
          if (!ch) return NO_CHANNEL;
          const r = await channelReport<Overview>(deps, ch, `overview:28d:${day}`, (d, a) => loadOverview(d, a, '28d'));
          return 'reason' in r ? r.reason : channelLines(r);
        }
        case 'videos': {
          if (!ch) return NO_CHANNEL;
          const r = await channelReport<Videos>(deps, ch, `videos:90d:${day}`, (d, a) => loadVideos(d, a, '90d'));
          return 'reason' in r ? r.reason : videoLines(r);
        }
        case 'terms': {
          if (!ch) return NO_CHANNEL;
          const r = await channelReport<SearchTerms>(deps, ch, `terms:90d:${day}`, (d, a) => loadSearchTerms(d, a, '90d'));
          if ('reason' in r) return r.reason;
          return r.terms.length || !r.note ? termLines(r) : r.note;
        }
        case 'competitors': {
          const tracked = await deps.db.prepare('SELECT COUNT(*) AS n FROM user_competitors WHERE user_id = ?').bind(userId).first<{ n: number }>();
          if (!tracked?.n) return "You don't track any competitors yet";
          const ups = await latestUploads(deps, userId, 20);
          if (!ups.length) return 'No uploads checked yet for your competitors';
          return ups.map((u) => {
            const n = val(u.views);
            const x = val(u.outlier);
            return flatten(`${flatten(u.channelTitle, 60)}: "${flatten(u.title, 100)}" — ${n === null ? 'views unknown' : views(n)}${x === null ? '' : `, ×${x}`}, published ${date(u.publishedAt)}`);
          });
        }
        case 'candidates':
          return 'Only the weekly brief reads this';
        case 'outliers': {
          const r = await findOutliers(deps, { format: 'any', days: 30, min: 3, size: 'any', q: '' });
          if (!r.rows.length) return 'No outliers in the pool for the last 30 days';
          return r.rows.slice(0, 15).map((o) => {
            const n = val(o.views);
            return flatten(`"${flatten(o.title, 100)}" (${flatten(o.channelTitle, 60)}) — ×${val(o.outlier)}${n === null ? '' : `, ${views(n)}`}`);
          });
        }
      }
    } catch (e) {
      return `Couldn't read this data (${e instanceof Error ? flatten(e.message, 80) : 'error'})`;
    }
  };

  const sources: AiSource[] = [];
  const missing: Missing[] = [];
  for (const kind of kinds) {
    const r = await linesFor(kind);
    const meta = LABELS[kind];
    if (typeof r === 'string') missing.push({ kind, label: meta.label, reason: r });
    else if (!r.length) missing.push({ kind, label: meta.label, reason: 'YouTube returned no data for these dates' });
    else sources.push({ id: '', kind, ...meta, lines: r.slice(0, MAX_LINES) });
  }
  sources.forEach((s, i) => (s.id = `S${i + 1}`));
  return { sources, missing };
}
