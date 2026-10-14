export const EMAIL_LINK_COOLDOWN_KEY = 'travelmate-email-link-cooldown-until';
export const EMAIL_LINK_COOLDOWN_MS = 60_000;
export const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

export type AuthUiState = 'checking' | 'signed-in' | 'signed-out';
export type CloudRequestState = 'local' | 'loading' | 'ready' | 'error';

export function cloudStatusLabel(input: {
  hasClient: boolean;
  configured: boolean;
  authResolved: boolean;
  hasUser: boolean;
  status: CloudRequestState;
  error: string;
}): string {
  if (!input.hasClient) return input.configured ? 'Configuration error' : 'Local demo mode';
  if (!input.authResolved) return 'Checking Supabase session';
  if (!input.hasUser) return 'Not signed in';
  if (input.status === 'loading') return 'Connecting to Supabase';
  if (input.status === 'ready') return 'Supabase data';
  if (/failed to fetch|networkerror|network request failed|fetch failed|connection (?:refused|timed out)/i.test(input.error)) return 'Connection error';
  return 'Cloud request error';
}

export function authUiState(resolved: boolean, hasUser: boolean): AuthUiState {
  if (!resolved) return 'checking';
  return hasUser ? 'signed-in' : 'signed-out';
}

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; code?: unknown; message?: unknown };
  return value.status === 429 ||
    (typeof value.code === 'string' && /rate.?limit|over_email_send_rate_limit/i.test(value.code)) ||
    (typeof value.message === 'string' && /rate.?limit|too many|email.*limit/i.test(value.message));
}

export function rateLimitMessage(): string {
  return 'Supabase is limiting email requests. Wait a few minutes before requesting another sign-in link.';
}

export function readCooldownUntil(storage: Pick<Storage, 'getItem' | 'removeItem'> | null, now = Date.now()): number {
  if (!storage) return 0;
  try {
    const value = Number(storage.getItem(EMAIL_LINK_COOLDOWN_KEY));
    if (!Number.isFinite(value) || value <= now) {
      storage.removeItem(EMAIL_LINK_COOLDOWN_KEY);
      return 0;
    }
    return value;
  } catch {
    return 0;
  }
}

export function saveCooldownUntil(storage: Pick<Storage, 'setItem'> | null, until: number): void {
  try { storage?.setItem(EMAIL_LINK_COOLDOWN_KEY, String(until)); } catch { /* cooldown is best effort */ }
}
