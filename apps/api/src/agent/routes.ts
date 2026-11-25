// The agent's API: the latest brief and its changes, the weekly switch, "make a brief now", approve or dismiss a change.
import type { AgentBriefRow, AgentChangeRow, AgentSettingsRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { aiUsage, label } from '../ai/router';
import { readSession } from '../session';
import { runBrief } from './brief';

const err = (c: Context, status: number, body: object) => c.json(body, status as 400);
const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export async function agentState(deps: Deps, userId: string) {
  const [settings, brief, changes, usage] = await Promise.all([
    deps.db.prepare('SELECT * FROM agent_settings WHERE user_id = ?').bind(userId).first<AgentSettingsRow>(),
    deps.db.prepare('SELECT * FROM agent_briefs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').bind(userId).first<AgentBriefRow>(),
    deps.db.prepare("SELECT * FROM agent_changes WHERE user_id = ? AND status != 'expired' ORDER BY created_at DESC LIMIT 20").bind(userId).all<AgentChangeRow>(),
    aiUsage(deps, userId),
  ]);
  return {
    settings: { weekly: !!settings?.weekly, lastAttemptAt: settings?.last_attempt_at ?? null, lastError: settings?.last_error ?? null },
    brief: brief ? {
      id: brief.id, createdAt: brief.created_at, trigger: brief.trigger,
      ai: { provider: brief.provider, label: label(brief.provider), model: brief.model, via: brief.via },
      tokens: { input: brief.input_tokens, output: brief.output_tokens },
      ideas: parse(brief.ideas, []), sources: parse(brief.sources, []), missing: parse(brief.missing, []), dropped: brief.dropped,
    } : null,
    changes: changes.results.map((r) => ({
      id: r.id, briefId: r.brief_id, videoId: r.video_id, beforeTitle: r.before_title, proposedTitle: r.proposed_title, why: r.why, sources: parse(r.sources, []),
      status: r.status, createdAt: r.created_at, approvedAt: r.approved_at, appliedOn: r.applied_on, appliedTitle: r.applied_title,
      check7: parse(r.check7, null), check28: parse(r.check28, null), lastCheckedAt: r.last_checked_at,
    })),
    usage: usage.brief,
  };
}

export function agentRoutes(app: Hono, deps: Deps): void {
  app.get('/api/agent', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, { error: 'signed_out', message: 'Sign in first.' });
    return c.json(await agentState(deps, s.userId));
  });

  app.post('/api/agent/settings', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, { error: 'signed_out', message: 'Sign in first.' });
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (typeof b.weekly !== 'boolean') return err(c, 400, { error: 'bad_request', message: 'Send weekly: true or false.' });
    await deps.db.prepare('INSERT INTO agent_settings (user_id, weekly, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET weekly = excluded.weekly, updated_at = excluded.updated_at, last_error = NULL')
      .bind(s.userId, b.weekly ? 1 : 0, new Date(deps.now()).toISOString()).run();
    return c.json(await agentState(deps, s.userId));
  });

  app.post('/api/agent/brief', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, { error: 'signed_out', message: 'Sign in first.' });
    const r = await runBrief(deps, s.userId, 'manual');
    if (!r.ok) return err(c, r.status, { error: r.error, message: r.message });
    return c.json(await agentState(deps, s.userId));
  });

  app.post('/api/agent/changes/:id', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, { error: 'signed_out', message: 'Sign in first.' });
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const now = new Date(deps.now()).toISOString();
    const id = c.req.param('id');
    let r: D1Result;
    if (b.action === 'approve') {
      r = await deps.db.prepare("UPDATE agent_changes SET status = 'approved', approved_at = ? WHERE id = ? AND user_id = ? AND status = 'proposed'").bind(now, id, s.userId).run();
    } else if (b.action === 'dismiss') {
      r = await deps.db.prepare("UPDATE agent_changes SET status = 'dismissed' WHERE id = ? AND user_id = ? AND status IN ('proposed', 'approved')").bind(id, s.userId).run();
    } else {
      return err(c, 400, { error: 'bad_request', message: 'Choose approve or dismiss.' });
    }
    if (!r.meta.changes) return err(c, 409, { error: 'conflict', message: 'This suggestion has already moved on. Reload to see where it is.' });
    return c.json(await agentState(deps, s.userId));
  });
}
