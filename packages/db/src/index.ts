/** Row shapes of packages/db/migrations. Times are ISO 8601 strings. */
export interface UserRow { id: string; google_sub: string; email: string | null; name: string | null; plan: string; created_at: string }
export interface SessionRow { id_hash: string; user_id: string; created_at: string; expires_at: string }
export interface OAuthStateRow { state: string; code_verifier: string; user_id: string | null; want_revenue: number; created_at: string }
export interface PendingConnectionRow {
  id: string; user_id: string; channel_id: string; title: string | null; handle: string | null; avatar_url: string | null;
  subscriber_count: number | null; video_count: number | null; scopes: string; refresh_token_enc: string; created_at: string;
}
export type ChannelStatus = 'active' | 'reconnect' | 'gone';
export interface ChannelRow {
  id: string; user_id: string; platform: 'youtube'; channel_id: string; title: string | null; handle: string | null; avatar_url: string | null;
  scopes: string; refresh_token_enc: string; status: ChannelStatus; status_reason: string | null; connected_at: string; last_verified_at: string;
}
export interface ReportCacheRow { channel_id: string; key: string; body: string; fetched_at: string }
export interface KeywordCacheRow { keyword: string; country: string; provider: string; body: string; fetched_at: string }
export interface TrackedChannelRow {
  channel_id: string; title: string; handle: string | null; last_polled_at: string | null; last_poll_ok_at: string | null; last_poll_error: string | null;
  subscribers: number | null; total_views: number | null; video_count: number | null; stats_at: string | null; created_at: string;
}
export interface FeedVideoRow { video_id: string; channel_id: string; title: string; published_at: string; format: string; first_seen_at: string }
export interface VideoSnapshotRow { video_id: string; at: string; views: number }
export interface AgentSettingsRow { user_id: string; weekly: number; last_attempt_at: string | null; last_error: string | null; updated_at: string }
export interface AgentBriefRow {
  id: string; user_id: string; channel_row_id: string; created_at: string; trigger: 'weekly' | 'manual'; provider: string; model: string; via: 'own' | 'included';
  input_tokens: number; output_tokens: number; ideas: string; sources: string; missing: string; dropped: number;
}
export type AgentChangeStatus = 'proposed' | 'approved' | 'dismissed' | 'applied' | 'expired';
export interface AgentChangeRow {
  id: string; user_id: string; channel_row_id: string; brief_id: string; video_id: string; published_at: string; before_title: string; proposed_title: string;
  why: string; sources: string; status: AgentChangeStatus; created_at: string; approved_at: string | null; applied_on: string | null; applied_title: string | null;
  check7: string | null; check28: string | null; last_checked_at: string | null;
}
