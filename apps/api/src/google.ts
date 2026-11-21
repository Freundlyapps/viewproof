/** Google OAuth + YouTube channel access. Implemented in plan 2 task 3. */
export const SCOPES = {
  signIn: ['openid', 'email', 'profile'],
  channel: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'],
  revenue: 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
} as const;

export interface TokenSet {
  refreshToken: string | null;
  accessToken: string;
  scopes: string[];
  idClaims: { sub: string; email?: string; name?: string };
}

export interface MyChannel {
  channelId: string;
  title: string;
  handle: string | null;
  avatarUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
}

export type GoogleError = { kind: 'revoked' } | { kind: 'failed'; reason: string };

export interface GoogleClient {
  authUrl(a: { state: string; challenge: string; wantRevenue: boolean; chooseAccount: boolean }): string;
  exchangeCode(code: string, verifier: string): Promise<TokenSet | GoogleError>;
  refresh(refreshToken: string): Promise<{ accessToken: string } | GoogleError>;
  myChannels(accessToken: string): Promise<MyChannel[] | GoogleError>;
  revoke(token: string): Promise<void>;
}
