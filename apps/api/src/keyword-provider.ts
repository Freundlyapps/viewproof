import { type KeywordProvider, dataForSeoProvider, noProvider } from '@viewproof/providers';

export interface KeywordEnv { DATAFORSEO_LOGIN?: string; DATAFORSEO_PASSWORD?: string; DATAFORSEO_DISPLAY_OK?: string }

/**
 * DataForSEO only when its credentials are set AND the operator confirms DataForSEO allowed end-user display
 * (spec §6 S5: blocked on a written OK). Otherwise trends are "off" with the reason.
 */
export function keywordProviderFor(env: KeywordEnv, fetchFn: typeof fetch): KeywordProvider {
  const creds = env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD ? { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD } : null;
  if (!creds) return noProvider('YouTube search interest is optional and not configured on this server.');
  if (env.DATAFORSEO_DISPLAY_OK !== 'yes') return noProvider('YouTube search interest is off: DataForSEO has not yet confirmed that its data may be shown to users.');
  return dataForSeoProvider(fetchFn, creds);
}
