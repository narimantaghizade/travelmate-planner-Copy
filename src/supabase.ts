import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_SUPABASE'));
export function isBrowserSafeSupabaseKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return false;
  const payload = value.split('.')[1];
  if (!payload) return true;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '='));
    return (JSON.parse(decoded) as { role?: string }).role !== 'service_role';
  } catch {
    return true;
  }
}
export const supabaseConfigurationError = isSupabaseConfigured && !isBrowserSafeSupabaseKey(key!)
  ? 'The configured key is a service-role/secret key. Replace it with the project publishable/anon key; secret keys must never be used in browser code.'
  : '';

let expectedTripInsertSessionUserId: string | null | undefined;

/** Arms a one-shot development diagnostic for the next trips POST. */
export function expectTripInsertSessionUser(userId: string | null): void {
  if (import.meta.env.DEV) expectedTripInsertSessionUserId = userId;
}

function jwtSubject(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '='))) as { sub?: unknown };
    return typeof parsed.sub === 'string' ? parsed.sub : null;
  } catch {
    return null;
  }
}

const diagnosticFetch: typeof fetch = (input, init) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (import.meta.env.DEV && method === 'POST' && new URL(requestUrl).pathname.endsWith('/rest/v1/trips') && expectedTripInsertSessionUserId !== undefined) {
    const expectedUserId = expectedTripInsertSessionUserId;
    expectedTripInsertSessionUserId = undefined;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const authorization = headers.get('Authorization');
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const requestSubject = jwtSubject(match?.[1] ?? null);
    console.info('[TravelMate PostgREST auth diagnostic]', {
      requestHasBearerToken: Boolean(match),
      requestUserMatchesSession: Boolean(expectedUserId && requestSubject && requestSubject === expectedUserId),
      requestHasUserSubject: Boolean(requestSubject),
    });
  }
  return fetch(input, init);
};

export const supabase = isSupabaseConfigured && !supabaseConfigurationError
  ? createClient<Database>(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: { fetch: diagnosticFetch },
    })
  : null;
