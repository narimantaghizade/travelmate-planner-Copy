export type InvitationRole = 'editor' | 'viewer';

export type InvitationInsert = {
  trip_id: string;
  invited_email: string;
  invited_role: InvitationRole;
  token_hash: string;
  invited_by: string;
  expires_at: string;
};

export type PendingInvitation = { id: string; expiresAt: string };

export class InvitationConflictError extends Error {}

export class EmailDeliveryError extends Error {
  constructor(readonly certainty: 'rejected' | 'unknown') {
    super('Email delivery failed');
  }
}

export type InvitationDependencies = {
  getVerifiedUser(accessToken: string): Promise<{ id: string } | null>;
  isTripOwner(tripId: string, verifiedUserId: string, accessToken: string): Promise<boolean>;
  isTripMember(tripId: string, normalizedEmail: string): Promise<boolean>;
  consumeInvitationRateLimit(verifiedUserId: string): Promise<boolean>;
  findPendingInvitation(tripId: string, normalizedEmail: string): Promise<PendingInvitation | null>;
  revokeExpiredInvitation(id: string, nowIso: string): Promise<void>;
  insertInvitation(row: InvitationInsert): Promise<{ id: string }>;
  revokeInvitation(id: string, nowIso: string): Promise<boolean>;
  sendInvitationEmail(input: { to: string; acceptanceUrl: string; role: InvitationRole }): Promise<void>;
  now?: () => Date;
  createToken?: () => string;
};

export type InvitationHandlerConfig = {
  appUrl: string;
  allowedOrigins: string[];
  ready?: boolean;
};

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRIP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const VALID_REQUEST_KEYS = new Set(['tripId', 'email', 'role']);

function jsonResponse(status: number, payload: Record<string, unknown>, origin?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Bytea(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const hex = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `\\x${hex}`;
}

function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  return normalized.length <= 254 && EMAIL_PATTERN.test(normalized) ? normalized : null;
}

function buildAcceptanceUrl(appUrl: string, token: string): string {
  const base = new URL(appUrl);
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
  base.search = '';
  base.hash = '';
  base.searchParams.set('invite', token);
  return base.toString();
}

function validAppUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!isLocalHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function parseBearerToken(request: Request): string | null {
  const value = request.headers.get('Authorization');
  const match = value?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function createTripInvitationHandler(
  dependencies: InvitationDependencies,
  config: InvitationHandlerConfig,
): (request: Request) => Promise<Response> {
  const appUrl = validAppUrl(config.appUrl);
  const allowedOrigins = new Set(config.allowedOrigins);

  return async request => {
    const origin = request.headers.get('Origin') ?? undefined;
    if (origin && !allowedOrigins.has(origin)) return jsonResponse(403, { error: 'Origin is not allowed.' });

    if (request.method === 'OPTIONS') {
      if (origin && !allowedOrigins.has(origin)) return jsonResponse(403, { error: 'Origin is not allowed.' });
      const headers = new Headers({
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      });
      if (origin) headers.set('Access-Control-Allow-Origin', origin);
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' }, origin);
    if (!appUrl || config.ready === false) return jsonResponse(503, { error: 'Invitation service is not configured.' }, origin);

    const accessToken = parseBearerToken(request);
    if (!accessToken) return jsonResponse(401, { error: 'Authentication is required.' }, origin);

    let verifiedUser: { id: string } | null;
    try {
      verifiedUser = await dependencies.getVerifiedUser(accessToken);
    } catch {
      return jsonResponse(401, { error: 'Authentication is required.' }, origin);
    }
    if (!verifiedUser) return jsonResponse(401, { error: 'Authentication is required.' }, origin);

    let body: Record<string, unknown>;
    try {
      const rawBody = await readBoundedBody(request, 4096);
      if (rawBody === null) return jsonResponse(400, { error: 'Invalid invitation request.' }, origin);
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse(400, { error: 'Invalid invitation request.' }, origin);
    }

    if (Object.keys(body).some(key => !VALID_REQUEST_KEYS.has(key))) {
      return jsonResponse(400, { error: 'Invitation request contains unsupported fields.' }, origin);
    }
    const tripId = typeof body.tripId === 'string' ? body.tripId : '';
    const email = normalizeEmail(body.email);
    const role = body.role;
    if (!TRIP_ID_PATTERN.test(tripId) || !email || (role !== 'editor' && role !== 'viewer')) {
      return jsonResponse(400, { error: 'Trip, recipient email, or invitation role is invalid.' }, origin);
    }

    try {
      if (!await dependencies.isTripOwner(tripId, verifiedUser.id, accessToken)) {
        return jsonResponse(403, { error: 'Only a trip owner can invite collaborators.' }, origin);
      }
    } catch {
      return jsonResponse(403, { error: 'Only a trip owner can invite collaborators.' }, origin);
    }

    // Count every otherwise-valid owner request before inspecting recipient
    // membership or pending records. Fail closed if the durable limiter is
    // missing or unavailable.
    try {
      if (!await dependencies.consumeInvitationRateLimit(verifiedUser.id)) {
        return jsonResponse(429, { error: 'Too many invitation requests. Wait before trying again.' }, origin);
      }
    } catch {
      return jsonResponse(503, { error: 'Invitation protection is temporarily unavailable. Try again later.' }, origin);
    }

    try {
      if (await dependencies.isTripMember(tripId, email)) {
        return jsonResponse(409, { error: 'This recipient is already a member of the trip.' }, origin);
      }
    } catch {
      return jsonResponse(500, { error: 'Could not verify trip membership. Try again later.' }, origin);
    }

    const now = (dependencies.now ?? (() => new Date()))();
    const nowIso = now.toISOString();
    try {
      const pending = await dependencies.findPendingInvitation(tripId, email);
      if (pending && new Date(pending.expiresAt).getTime() > now.getTime()) {
        return jsonResponse(409, { error: 'An invitation is already pending for this recipient.' }, origin);
      }
      if (pending) await dependencies.revokeExpiredInvitation(pending.id, nowIso);
    } catch {
      return jsonResponse(500, { error: 'Could not prepare the invitation. Try again later.' }, origin);
    }

    const token = (dependencies.createToken ?? createToken)();
    let invitationId: string;
    try {
      invitationId = (await dependencies.insertInvitation({
        trip_id: tripId,
        invited_email: email,
        invited_role: role,
        token_hash: await sha256Bytea(token),
        invited_by: verifiedUser.id,
        expires_at: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
      })).id;
    } catch (error) {
      if (error instanceof InvitationConflictError) {
        return jsonResponse(409, { error: 'An invitation is already pending for this recipient.' }, origin);
      }
      return jsonResponse(500, { error: 'Could not create the invitation. Try again later.' }, origin);
    }

    try {
      await dependencies.sendInvitationEmail({
        to: email,
        acceptanceUrl: buildAcceptanceUrl(appUrl.toString(), token),
        role,
      });
    } catch (error) {
      if (error instanceof EmailDeliveryError && error.certainty === 'rejected') {
        try {
          const revoked = await dependencies.revokeInvitation(invitationId, (dependencies.now ?? (() => new Date()))().toISOString());
          if (revoked) {
            return jsonResponse(502, {
              status: 'delivery_failed',
              invitationStatus: 'revoked',
              error: 'The email provider rejected delivery. The invitation was revoked; try again later.',
            }, origin);
          }
        } catch {
          // Provider rejection is confirmed even if cleanup cannot be confirmed.
        }
        return jsonResponse(502, {
          status: 'delivery_failed_cleanup_required',
          invitationStatus: 'active_or_unknown',
          error: 'The email provider rejected delivery, but invitation cleanup could not be confirmed. Contact support before retrying.',
        }, origin);
      }
      return jsonResponse(502, {
        status: 'delivery_uncertain',
        invitationStatus: 'pending',
        error: 'Email delivery could not be confirmed. The invitation remains pending; check provider delivery status before requesting another.',
      }, origin);
    }

    return jsonResponse(201, {
      ok: true,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
    }, origin);
  };
}
