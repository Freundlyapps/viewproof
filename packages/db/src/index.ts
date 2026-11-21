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
