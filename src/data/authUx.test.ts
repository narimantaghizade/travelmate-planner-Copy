import { describe, expect, it } from 'vitest';
import {
  authUiState,
  cloudStatusLabel,
  EMAIL_LINK_COOLDOWN_KEY,
  EMAIL_LINK_COOLDOWN_MS,
  isRateLimitError,
  RATE_LIMIT_COOLDOWN_MS,
  rateLimitMessage,
  readCooldownUntil,
  saveCooldownUntil,
} from './authUx';

describe('authentication UX state', () => {
  it('waits for session restoration and distinguishes authenticated from missing sessions', () => {
    expect(authUiState(false, false)).toBe('checking');
    expect(authUiState(true, true)).toBe('signed-in');
    expect(authUiState(true, false)).toBe('signed-out');
  });

  it('distinguishes a missing sign-in session from connection and other request errors', () => {
    const base = { hasClient: true, configured: true, authResolved: true, hasUser: false, status: 'error' as const, error: 'Sign in to Supabase Auth' };
    expect(cloudStatusLabel(base)).toBe('Not signed in');
    expect(cloudStatusLabel({ ...base, hasUser: true, error: 'TypeError: Failed to fetch' })).toBe('Connection error');
    expect(cloudStatusLabel({ ...base, hasUser: true, error: 'new row violates row-level security policy' })).toBe('Cloud request error');
    expect(cloudStatusLabel({ ...base, hasClient: false, hasUser: false })).toBe('Configuration error');
  });

  it('recognizes rate limits and advises the user to wait', () => {
    expect(isRateLimitError({ status: 429, message: 'Too many requests' })).toBe(true);
    expect(isRateLimitError({ code: 'over_email_send_rate_limit' })).toBe(true);
    expect(isRateLimitError({ message: 'Invalid email' })).toBe(false);
    expect(rateLimitMessage()).toMatch(/wait a few minutes/i);
  });

  it('persists only a cooldown timestamp and clears expired cooldowns', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const until = 200_000;
    saveCooldownUntil(storage, until);
    expect(values.get(EMAIL_LINK_COOLDOWN_KEY)).toBe(String(until));
    expect(readCooldownUntil(storage, 100_000)).toBe(until);
    expect(readCooldownUntil(storage, until)).toBe(0);
    expect(values.has(EMAIL_LINK_COOLDOWN_KEY)).toBe(false);
    expect(EMAIL_LINK_COOLDOWN_MS).toBe(60_000);
    expect(RATE_LIMIT_COOLDOWN_MS).toBe(300_000);
  });
});
