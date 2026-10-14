import { describe, expect, it, vi } from 'vitest';
import {
  acceptInvitationAndLoadTrip,
  invitationAuthRedirect,
  parseInvitation,
  removeInvitationFromUrl,
} from './invitationAcceptance';

const token = 'A'.repeat(43);

describe('invitation URL helpers', () => {
  it('parses only a valid invitation token and distinguishes absent from invalid', () => {
    expect(parseInvitation('?invite=' + token)).toEqual({ kind: 'token', token });
    expect(parseInvitation('?other=value')).toEqual({ kind: 'absent' });
    expect(parseInvitation('?invite=short')).toEqual({ kind: 'invalid' });
  });

  it('preserves the invite token at the configured GitHub Pages base path for auth callbacks', () => {
    expect(invitationAuthRedirect(
      `https://traveler.github.io/travelmate-planner/?invite=${token}#old-fragment`,
      '/travelmate-planner/',
    )).toBe(`https://traveler.github.io/travelmate-planner/?invite=${token}`);
  });

  it('removes only the invitation query parameter after an attempt', () => {
    expect(removeInvitationFromUrl(`/travelmate-planner/?keep=yes&invite=${token}#auth-callback`))
      .toBe('/travelmate-planner/?keep=yes#auth-callback');
  });
});

describe('invitation acceptance flow', () => {
  it('accepts with the token, reloads trips and returns only a trip visible to the user', async () => {
    const accept = vi.fn().mockResolvedValue({ tripId: 'trip-1' });
    const loadTrips = vi.fn().mockResolvedValue({ trips: [{ id: 'trip-1' }], value: { trips: ['trip-1'] } });
    await expect(acceptInvitationAndLoadTrip(token, { accept, loadTrips })).resolves.toEqual({
      tripId: 'trip-1', workspace: { trips: ['trip-1'] },
    });
    expect(accept).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith(token);
    expect(loadTrips).toHaveBeenCalledOnce();
  });

  it('maps invalid, expired, revoked and email-mismatch responses to a safe message', async () => {
    await expect(acceptInvitationAndLoadTrip(token, {
      accept: async () => ({ tripId: null, errorCode: '22023' }),
      loadTrips: async () => ({ trips: [], value: null }),
    })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('does not continue if the accepted trip is absent from the refreshed RLS-filtered trip list', async () => {
    const loadTrips = vi.fn().mockResolvedValue({ trips: [{ id: 'other-trip' }], value: null });
    await expect(acceptInvitationAndLoadTrip(token, {
      accept: async () => ({ tripId: 'trip-1' }), loadTrips,
    })).rejects.toMatchObject({ kind: 'accepted-unavailable' });
  });

  it('classifies an RPC transport failure as an uncertain outcome and does not retry', async () => {
    const accept = vi.fn().mockRejectedValue(new Error('private transport details'));
    const loadTrips = vi.fn();
    await expect(acceptInvitationAndLoadTrip(token, { accept, loadTrips }))
      .rejects.toMatchObject({ kind: 'uncertain', message: expect.stringContaining('Do not reopen or reuse') });
    expect(accept).toHaveBeenCalledOnce();
    expect(loadTrips).not.toHaveBeenCalled();
  });

  it('handles a confirmed RPC rejection separately without exposing the database message', async () => {
    const loadTrips = vi.fn();
    await expect(acceptInvitationAndLoadTrip(token, {
      accept: async () => ({ tripId: null, errorCode: '23514' }), loadTrips,
    })).rejects.toMatchObject({ kind: 'rejected', message: expect.not.stringContaining('23514') });
    expect(loadTrips).not.toHaveBeenCalled();
  });

  it('reports that acceptance may have succeeded when the trip reload fails', async () => {
    const accept = vi.fn().mockResolvedValue({ tripId: 'trip-1' });
    const loadTrips = vi.fn().mockRejectedValue(new Error('private database details'));
    await expect(acceptInvitationAndLoadTrip(token, { accept, loadTrips }))
      .rejects.toMatchObject({ kind: 'accepted-unavailable', message: expect.stringContaining('was accepted') });
    expect(accept).toHaveBeenCalledOnce();
    expect(loadTrips).toHaveBeenCalledOnce();
  });
});
