import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTripInvitationHandler,
  EmailDeliveryError,
  InvitationConflictError,
  type InvitationDependencies,
  type InvitationInsert,
  type PendingInvitation,
} from './createTripInvitation';

const APP_URL = 'https://travelmate.example/pages';
const ORIGIN = 'https://travelmate.example';
const TRIP_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const NOW = new Date('2030-01-01T12:00:00.000Z');

function setup(overrides: Partial<InvitationDependencies> = {}) {
  const events: string[] = [];
  const inserted: InvitationInsert[] = [];
  const sent: Array<{ to: string; acceptanceUrl: string; role: 'editor' | 'viewer' }> = [];
  const revoked: string[] = [];
  const revokeResult = { value: true };
  const dependencies: InvitationDependencies = {
    getVerifiedUser: vi.fn(async () => ({ id: 'verified-owner-id' })),
    isTripOwner: vi.fn(async (_tripId, userId) => userId === 'verified-owner-id'),
    isTripMember: vi.fn(async () => false),
    consumeInvitationRateLimit: vi.fn(async () => true),
    findPendingInvitation: vi.fn(async () => null),
    revokeExpiredInvitation: vi.fn(async id => { revoked.push(id); }),
    insertInvitation: vi.fn(async row => {
      events.push('insert');
      inserted.push(row);
      return { id: 'invitation-record-id' };
    }),
    revokeInvitation: vi.fn(async id => { revoked.push(id); return revokeResult.value; }),
    sendInvitationEmail: vi.fn(async input => {
      events.push('email');
      sent.push(input);
    }),
    now: () => new Date(NOW),
    ...overrides,
  };
  const handler = createTripInvitationHandler(dependencies, {
    appUrl: APP_URL,
    allowedOrigins: [ORIGIN],
  });
  const request = (body: unknown = { tripId: TRIP_ID, email: '  Friend@Example.com ', role: 'viewer' }, token = 'verified-access-token') =>
    new Request('https://edge.example/create-trip-invitation', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { dependencies, handler, request, inserted, sent, revoked, events, revokeResult };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('create trip invitation handler (mocked dependencies)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('rejects unauthenticated requests before owner checks or writes', async () => {
    const setupResult = setup({ getVerifiedUser: vi.fn(async () => null) });
    const response = await setupResult.handler(setupResult.request());
    expect(response.status).toBe(401);
    expect(setupResult.dependencies.isTripOwner).not.toHaveBeenCalled();
    expect(setupResult.dependencies.insertInvitation).not.toHaveBeenCalled();
  });

  it('rejects non-owner requests without creating or emailing invitations', async () => {
    const setupResult = setup({ isTripOwner: vi.fn(async () => false) });
    const response = await setupResult.handler(setupResult.request());
    expect(response.status).toBe(403);
    expect(setupResult.dependencies.insertInvitation).not.toHaveBeenCalled();
    expect(setupResult.dependencies.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('rejects a recipient who is already a trip member without writing or emailing', async () => {
    const setupResult = setup({ isTripMember: vi.fn(async () => true) });
    const response = await setupResult.handler(setupResult.request());
    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: 'This recipient is already a member of the trip.' });
    expect(setupResult.dependencies.findPendingInvitation).not.toHaveBeenCalled();
    expect(setupResult.dependencies.insertInvitation).not.toHaveBeenCalled();
    expect(setupResult.dependencies.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('enforces the durable per-owner rate limit and fails closed if unavailable', async () => {
    const limited = setup({ consumeInvitationRateLimit: vi.fn(async userId => userId !== 'verified-owner-id') });
    const limitedResponse = await limited.handler(limited.request());
    expect(limitedResponse.status).toBe(429);
    expect(limited.dependencies.isTripMember).not.toHaveBeenCalled();
    expect(limited.dependencies.insertInvitation).not.toHaveBeenCalled();

    const unavailable = setup({ consumeInvitationRateLimit: vi.fn(async () => { throw new Error('private db error'); }) });
    const unavailableResponse = await unavailable.handler(unavailable.request());
    expect(unavailableResponse.status).toBe(503);
    expect(unavailable.dependencies.insertInvitation).not.toHaveBeenCalled();
  });

  it('rejects invalid email, owner role, caller identity, and caller redirect fields', async () => {
    for (const bodyValue of [
      { tripId: TRIP_ID, email: 'bad-email', role: 'viewer' },
      { tripId: TRIP_ID, email: 'friend@example.com', role: 'owner' },
      { tripId: TRIP_ID, email: 'friend@example.com', role: 'viewer', invited_by: 'attacker' },
      { tripId: TRIP_ID, email: 'friend@example.com', role: 'viewer', redirectUrl: 'https://evil.example' },
    ]) {
      const setupResult = setup();
      const response = await setupResult.handler(setupResult.request(bodyValue));
      expect(response.status).toBe(400);
      expect(setupResult.dependencies.insertInvitation).not.toHaveBeenCalled();
    }
  });

  it('revokes an expired pending record before replacement and normalizes the recipient email', async () => {
    const setupResult = setup({
      findPendingInvitation: vi.fn(async () => ({ id: 'expired-id', expiresAt: '2030-01-01T11:59:59.000Z' } satisfies PendingInvitation)),
    });
    const response = await setupResult.handler(setupResult.request());
    expect(response.status).toBe(201);
    expect(setupResult.dependencies.revokeExpiredInvitation).toHaveBeenCalledWith('expired-id', NOW.toISOString());
    expect(setupResult.inserted[0].invited_email).toBe('friend@example.com');
  });

  it('does not invalidate, replace, or resend an existing valid pending invitation', async () => {
    const setupResult = setup({
      findPendingInvitation: vi.fn(async () => ({ id: 'valid-id', expiresAt: '2030-01-02T12:00:00.000Z' } satisfies PendingInvitation)),
    });
    const response = await setupResult.handler(setupResult.request());
    expect(response.status).toBe(409);
    expect(setupResult.dependencies.revokeExpiredInvitation).not.toHaveBeenCalled();
    expect(setupResult.dependencies.insertInvitation).not.toHaveBeenCalled();
    expect(setupResult.dependencies.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('handles a concurrent duplicate insert as a conflict without sending another email', async () => {
    const setupResult = setup({ insertInvitation: vi.fn(async () => { throw new InvitationConflictError(); }) });
    const response = await setupResult.handler(setupResult.request());
    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: 'An invitation is already pending for this recipient.' });
    expect(setupResult.dependencies.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('stores only a SHA-256 bytea digest and sends the raw token only in the email link', async () => {
    const setupResult = setup();
    const response = await setupResult.handler(setupResult.request());
    const emailUrl = new URL(setupResult.sent[0].acceptanceUrl);
    const rawToken = emailUrl.searchParams.get('invite')!;
    const responseBody = await body(response);
    const expectedDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken)));
    const expectedHex = [...expectedDigest].map(byte => byte.toString(16).padStart(2, '0')).join('');

    expect(response.status).toBe(201);
    expect(setupResult.inserted[0].token_hash).toBe(`\\x${expectedHex}`);
    expect(setupResult.inserted[0]).not.toHaveProperty('token');
    expect(setupResult.inserted[0].invited_by).toBe('verified-owner-id');
    expect(setupResult.inserted[0].expires_at).toBe('2030-01-08T12:00:00.000Z');
    expect(emailUrl.pathname).toBe('/pages/');
    expect(responseBody).not.toHaveProperty('token');
    expect(JSON.stringify(responseBody)).not.toContain(rawToken);
    expect(setupResult.events).toEqual(['insert', 'email']);
  });

  it('does not send email when the database insert fails and returns no database detail', async () => {
    const setupResult = setup({ insertInvitation: vi.fn(async () => { throw new Error('private database detail'); }) });
    const response = await setupResult.handler(setupResult.request());
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({ error: 'Could not create the invitation. Try again later.' });
    expect(setupResult.dependencies.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('reports confirmed provider rejection and successful cleanup without returning its token', async () => {
    const setupResult = setup({
      sendInvitationEmail: vi.fn(async () => { throw new EmailDeliveryError('rejected'); }),
    });
    const response = await setupResult.handler(setupResult.request());
    expect(response.status).toBe(502);
    expect(setupResult.dependencies.revokeInvitation).toHaveBeenCalledWith('invitation-record-id', NOW.toISOString());
    const responseBody = await body(response);
    expect(responseBody).toMatchObject({ status: 'delivery_failed', invitationStatus: 'revoked' });
    expect(JSON.stringify(responseBody)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('distinguishes confirmed provider rejection from failed or unconfirmed cleanup', async () => {
    const cleanupFailure = setup({
      sendInvitationEmail: vi.fn(async () => { throw new EmailDeliveryError('rejected'); }),
      revokeInvitation: vi.fn(async () => { throw new Error('private cleanup failure'); }),
    });
    const response = await cleanupFailure.handler(cleanupFailure.request());
    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({ status: 'delivery_failed_cleanup_required', invitationStatus: 'active_or_unknown' });

    const cleanupNotConfirmed = setup({
      sendInvitationEmail: vi.fn(async () => { throw new EmailDeliveryError('rejected'); }),
    });
    cleanupNotConfirmed.revokeResult.value = false;
    const unconfirmed = await cleanupNotConfirmed.handler(cleanupNotConfirmed.request());
    expect(await body(unconfirmed)).toMatchObject({ status: 'delivery_failed_cleanup_required' });
  });

  it('keeps an invitation pending when provider delivery is uncertain and blocks arbitrary origins', async () => {
    const uncertain = setup({
      sendInvitationEmail: vi.fn(async () => { throw new EmailDeliveryError('unknown'); }),
    });
    const response = await uncertain.handler(uncertain.request());
    expect(response.status).toBe(502);
    expect(uncertain.dependencies.revokeInvitation).not.toHaveBeenCalled();
    expect(await body(response)).toMatchObject({ status: 'delivery_uncertain', invitationStatus: 'pending' });

    const originAttack = await uncertain.handler(new Request('https://edge.example/create-trip-invitation', {
      method: 'POST',
      headers: { Authorization: 'Bearer verified-access-token', Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripId: TRIP_ID, email: 'friend@example.com', role: 'viewer' }),
    }));
    expect(originAttack.status).toBe(403);
  });
});
