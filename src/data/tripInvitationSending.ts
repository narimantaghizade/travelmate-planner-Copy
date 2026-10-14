export type TripInvitationRole = 'editor' | 'viewer';

export type TripInvitationRequest = {
  tripId: string;
  email: string;
  role: TripInvitationRole;
};

export type TripInvitationResult =
  | { kind: 'sent'; expiresAt: string }
  | { kind: 'error'; message: string; uncertain: boolean };

type FunctionError = { context?: unknown } | null;
type FunctionResponse = { data: unknown; error: FunctionError };
export type InvitationFunctionInvoker = (
  functionName: 'create-trip-invitation',
  options: { body: TripInvitationRequest },
) => Promise<FunctionResponse>;

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export async function sendTripInvitation(
  invoke: InvitationFunctionInvoker,
  request: TripInvitationRequest,
): Promise<TripInvitationResult> {
  if (!request.tripId || !EMAIL_PATTERN.test(request.email.trim()) || (request.role !== 'editor' && request.role !== 'viewer')) {
    return { kind: 'error', message: 'Enter a valid email address and choose an invitation role.', uncertain: false };
  }

  let response: FunctionResponse;
  try {
    response = await invoke('create-trip-invitation', {
      body: { tripId: request.tripId, email: request.email.trim(), role: request.role },
    });
  } catch {
    return { kind: 'error', message: 'We could not confirm whether the invitation email was delivered. Check the invitation status before trying again.', uncertain: true };
  }

  if (!response.error && isSuccessResponse(response.data)) {
    return { kind: 'sent', expiresAt: response.data.expiresAt };
  }

  const status = responseStatus(response.error);
  if (status === 400) return { kind: 'error', message: 'Check the recipient email and invitation details, then try again.', uncertain: false };
  if (status === 401) return { kind: 'error', message: 'Your sign-in session is no longer valid. Sign in again before inviting someone.', uncertain: false };
  if (status === 403) return { kind: 'error', message: 'Only the trip owner can invite collaborators. Confirm you are signed in to the owner account.', uncertain: false };
  if (status === 409) return { kind: 'error', message: 'This person is already a trip member or has a pending invitation.', uncertain: false };
  if (status === 429) return { kind: 'error', message: 'Too many invitation requests. Wait before trying again.', uncertain: false };
  if (status === 502) return deliveryFailure(response.error);
  if (status === 500 || status === 503) return { kind: 'error', message: 'The invitation service is temporarily unavailable. Try again later.', uncertain: false };

  // A missing response can mean the request reached the function but its
  // response was lost, so do not encourage a duplicate invitation attempt.
  return { kind: 'error', message: 'We could not confirm whether the invitation email was delivered. Check the invitation status before trying again.', uncertain: true };
}

function isSuccessResponse(value: unknown): value is { ok: true; expiresAt: string } {
  return !!value && typeof value === 'object'
    && 'ok' in value && value.ok === true
    && 'expiresAt' in value && typeof value.expiresAt === 'string';
}

function responseStatus(error: FunctionError): number | undefined {
  if (!error || typeof error.context !== 'object' || error.context === null || !('status' in error.context)) return undefined;
  const status = error.context.status;
  return typeof status === 'number' ? status : undefined;
}

async function deliveryFailure(error: FunctionError): Promise<TripInvitationResult> {
  if (error?.context && typeof error.context === 'object' && 'json' in error.context && typeof error.context.json === 'function') {
    try {
      const body: unknown = await error.context.json();
      if (body && typeof body === 'object' && 'status' in body) {
        if (body.status === 'delivery_failed' && 'invitationStatus' in body && body.invitationStatus === 'revoked') {
          return { kind: 'error', message: 'The email provider rejected delivery and the invitation was revoked. You can try again later.', uncertain: false };
        }
        if (body.status === 'delivery_failed_cleanup_required') {
          return { kind: 'error', message: 'The email provider rejected delivery, but invitation cleanup could not be confirmed. Contact support before trying again.', uncertain: true };
        }
      }
    } catch {
      // Do not expose provider or server response details.
    }
  }
  return { kind: 'error', message: 'Email delivery could not be confirmed. Check the invitation status before trying again.', uncertain: true };
}
