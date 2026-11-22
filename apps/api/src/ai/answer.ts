// Reading the model's answer: structured items for quick actions, citations for Ask AI.

export interface AiItem { text: string; why: string; sources: string[] }

/** Tolerates code fences and prose around the JSON; null when there is no usable item. Unknown source ids are dropped. */
export function parseItems(text: string, known: Set<string>): AiItem[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) return null;
  const out: AiItem[] = [];
  for (const i of items) {
    if (!i || typeof i !== 'object') continue;
    const r = i as Record<string, unknown>;
    if (typeof r.text !== 'string' || !r.text.trim()) continue;
    const sources = Array.isArray(r.sources) ? [...new Set(r.sources.filter((s): s is string => typeof s === 'string' && known.has(s)))] : [];
    out.push({ text: r.text.trim(), why: typeof r.why === 'string' ? r.why.trim() : '', sources });
  }
  return out.length ? out : null;
}

/** [S1]-style citations in an answer, split into ones we sent and ones we didn't. */
export function citations(text: string, known: Set<string>): { cited: string[]; unknown: string[] } {
  const ids = [...new Set([...text.matchAll(/\[(S\d{1,2})\]/g)].map((m) => m[1]!))];
  return { cited: ids.filter((i) => known.has(i)), unknown: ids.filter((i) => !known.has(i)) };
}
