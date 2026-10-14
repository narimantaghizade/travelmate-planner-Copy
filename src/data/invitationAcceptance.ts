export type ParsedInvitation =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'token'; token: string };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export function parseInvitation(search: string): ParsedInvitation {
  const params = new URLSearchParams(search);
  if (!params.has('invite')) return { kind: 'absent' };
  const token = params.get('invite');
  return token && TOKEN_PATTERN.test(token) ? { kind: 'token', token } : { kind: 'invalid' };
}

/** Build the auth callback URL at Vite's configured app root, retaining only the invite token. */
export function invitationAuthRedirect(currentHref: string, baseUrl: string): string {
  const current = new URL(currentHref);
  const redirect = new URL(baseUrl, current.origin);
  const invite = current.searchParams.get('invite');
  if (invite) redirect.searchParams.set('invite', invite);
  return redirect.toString();
}

export function removeInvitationFromUrl(currentHref: string): string {
  const current = new URL(currentHref, 'https://travelmate.invalid');
  current.searchParams.delete('invite');
  return `${current.pathname}${current.search}${current.hash}`;
}

export class InvitationAcceptanceError extends Error {
  constructor(readonly kind: 'invalid' | 'authentication' | 'rejected' | 'uncertain' | 'accepted-unavailable') {
    super(invitationAcceptanceMessage(kind));
    this.name = 'InvitationAcceptanceError';
  }
}

export function invitationAcceptanceMessage(kind: InvitationAcceptanceError['kind']): string {
  if (kind === 'invalid') return 'This invitation is invalid, expired, revoked, already used, or belongs to a different account.';
  if (kind === 'authentication') return 'Your sign-in session is unavailable. Sign in again before accepting this invitation.';
  if (kind === 'rejected') return 'The invitation could not be accepted. Check that you are signed in with the invited account, or ask the trip owner for help.';
  if (kind === 'uncertain') return 'We could not confirm whether acceptance completed. Do not reopen or reuse this invitation yet. Reload this page to refresh your trip list and check whether it was added.';
  return 'The invitation was accepted, but TravelMate could not refresh your trips. Reload this page or return to your trip list; do not reopen the same invitation.';
}

export type InvitationAcceptanceWorkspace<T> = { trips: Array<{ id: string }>; value: T };

export async function acceptInvitationAndLoadTrip<T>(
  token: string,
  dependencies: {
    accept(token: string): Promise<{ tripId: string | null; errorCode?: string | null }>;
    loadTrips(): Promise<InvitationAcceptanceWorkspace<T>>;
  },
): Promise<{ tripId: string; workspace: T }> {
  let accepted: { tripId: string | null; errorCode?: string | null };
  try {
    accepted = await dependencies.accept(token);
  } catch {
    throw new InvitationAcceptanceError('uncertain');
  }
  if (accepted.errorCode) {
    if (accepted.errorCode === '22023') throw new InvitationAcceptanceError('invalid');
    if (accepted.errorCode === '42501' || accepted.errorCode === '401' || accepted.errorCode === 'PGRST301' || accepted.errorCode === 'PGRST302') throw new InvitationAcceptanceError('authentication');
    throw new InvitationAcceptanceError('rejected');
  }
  if (!accepted.tripId) throw new InvitationAcceptanceError('rejected');

  let loaded: InvitationAcceptanceWorkspace<T>;
  try {
    loaded = await dependencies.loadTrips();
  } catch {
    throw new InvitationAcceptanceError('accepted-unavailable');
  }
  if (!loaded.trips.some(trip => trip.id === accepted.tripId)) {
    throw new InvitationAcceptanceError('accepted-unavailable');
  }
  return { tripId: accepted.tripId, workspace: loaded.value };
}
