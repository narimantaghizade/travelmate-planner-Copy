import { describe, expect, it, vi } from 'vitest';
import { sendTripInvitation, type InvitationFunctionInvoker } from './tripInvitationSending';

const request = { tripId: 'trip-123', email: 'friend@example.com', role: 'viewer' as const };

function invokerReturning(status: number, body: unknown = {}) {
  return vi.fn<InvitationFunctionInvoker>().mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } });
}

describe('trip invitation sending', () => {
  it('uses the exact Edge Function request contract and reports only confirmed success', async () => {
    const invoke = vi.fn<InvitationFunctionInvoker>().mockResolvedValue({
      data: { ok: true, expiresAt: '2030-01-08T12:00:00.000Z' }, error: null,
    });

    await expect(sendTripInvitation(invoke, { ...request, email: '  friend@example.com  ' })).resolves.toEqual({
      kind: 'sent', expiresAt: '2030-01-08T12:00:00.000Z',
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('create-trip-invitation', {
      body: { tripId: request.tripId, email: request.email, role: request.role },
    });
  });

  it.each([
    [400, 'Check the recipient email'],
    [401, 'sign-in session'],
    [403, 'Only the trip owner'],
    [409, 'already a trip member or has a pending invitation'],
    [429, 'Wait before trying again'],
  ])('handles HTTP %i with a safe message', async (status, expected) => {
    const result = await sendTripInvitation(invokerReturning(status), request);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain(expected);
      expect(result.uncertain).toBe(false);
    }
  });

  it('reports an uncertain delivery without encouraging a retry', async () => {
    const invoke = vi.fn<InvitationFunctionInvoker>().mockRejectedValue(new Error('network failure'));
    await expect(sendTripInvitation(invoke, request)).resolves.toMatchObject({
      kind: 'error', uncertain: true, message: expect.stringContaining('Check the invitation status before trying again'),
    });
  });

  it('distinguishes confirmed provider rejection with successful cleanup', async () => {
    const invoke = invokerReturning(502, { status: 'delivery_failed', invitationStatus: 'revoked' });
    await expect(sendTripInvitation(invoke, request)).resolves.toMatchObject({
      kind: 'error', uncertain: false, message: expect.stringContaining('invitation was revoked'),
    });
  });

  it('does not suggest retry when provider rejection cleanup is unknown', async () => {
    const invoke = invokerReturning(502, { status: 'delivery_failed_cleanup_required', invitationStatus: 'active_or_unknown' });
    await expect(sendTripInvitation(invoke, request)).resolves.toMatchObject({
      kind: 'error', uncertain: true, message: expect.stringContaining('Contact support before trying again'),
    });
  });

  it('treats uncertain provider delivery as pending and avoids retry advice', async () => {
    const invoke = invokerReturning(502, { status: 'delivery_uncertain', invitationStatus: 'pending' });
    await expect(sendTripInvitation(invoke, request)).resolves.toMatchObject({
      kind: 'error', uncertain: true, message: expect.stringContaining('Check the invitation status before trying again'),
    });
  });

  it('validates input before making a request', async () => {
    const invoke = vi.fn<InvitationFunctionInvoker>();
    await expect(sendTripInvitation(invoke, { ...request, email: 'not-an-email' })).resolves.toMatchObject({ kind: 'error' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
