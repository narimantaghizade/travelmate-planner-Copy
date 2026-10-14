import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import {
  createTripInvitationHandler,
  EmailDeliveryError,
  InvitationConflictError,
  type InvitationInsert,
} from '../_shared/createTripInvitation.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
function readDefaultKey(legacyName: string, keyMapName: string): string {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  try {
    const keyMap = JSON.parse(Deno.env.get(keyMapName) ?? '{}') as Record<string, unknown>;
    return typeof keyMap.default === 'string' ? keyMap.default : '';
  } catch {
    return '';
  }
}

const anonKey = readDefaultKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
const serviceRoleKey = readDefaultKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
const appUrl = Deno.env.get('APP_URL') ?? '';
const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
const emailFrom = Deno.env.get('EMAIL_FROM') ?? '';
const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function getAppOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigin(value: string): string | null {
  try {
    if (value === '*') return null;
    const url = new URL(value);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const appOrigin = getAppOrigin(appUrl);
const allowedOrigins = [...new Set([...(appOrigin ? [appOrigin] : []), ...configuredOrigins.map(parseAllowedOrigin).filter((origin): origin is string => Boolean(origin))])];
const ready = Boolean(supabaseUrl && anonKey && serviceRoleKey && appUrl && resendApiKey && emailFrom && appOrigin);

const dependencies = {
  async getVerifiedUser(accessToken: string): Promise<{ id: string } | null> {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return { id: data.user.id };
  },

  async isTripOwner(tripId: string, verifiedUserId: string, accessToken: string): Promise<boolean> {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData.user || userData.user.id !== verifiedUserId) return false;
    const { data, error } = await authClient.rpc('is_trip_owner', { target_trip: tripId });
    if (error) throw new Error('Owner check failed');
    return data === true;
  },

  async isTripMember(tripId: string, normalizedEmail: string): Promise<boolean> {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await admin.rpc('trip_has_member_email', {
      target_trip: tripId,
      target_email: normalizedEmail,
    });
    if (error || typeof data !== 'boolean') throw new Error('Trip member lookup failed');
    return data;
  },

  async consumeInvitationRateLimit(verifiedUserId: string): Promise<boolean> {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await admin.rpc('consume_trip_invitation_rate_limit', {
      target_user: verifiedUserId,
    });
    if (error || typeof data !== 'boolean') throw new Error('Invitation rate limit unavailable');
    return data;
  },

  async findPendingInvitation(tripId: string, normalizedEmail: string) {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await admin
      .from('trip_invitations')
      .select('id, expires_at')
      .eq('trip_id', tripId)
      .eq('invited_email', normalizedEmail)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw new Error('Pending invitation lookup failed');
    return data ? { id: data.id as string, expiresAt: data.expires_at as string } : null;
  },

  async revokeExpiredInvitation(id: string, nowIso: string): Promise<void> {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error } = await admin
      .from('trip_invitations')
      .update({ revoked_at: nowIso })
      .eq('id', id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .lte('expires_at', nowIso);
    if (error) throw new Error('Expired invitation cleanup failed');
  },

  async insertInvitation(row: InvitationInsert): Promise<{ id: string }> {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await admin.from('trip_invitations').insert(row).select('id').single();
    if (error?.code === '23505') throw new InvitationConflictError();
    if (error || !data) throw new Error('Invitation insert failed');
    return { id: data.id as string };
  },

  async revokeInvitation(id: string, nowIso: string): Promise<boolean> {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await admin
      .from('trip_invitations')
      .update({ revoked_at: nowIso })
      .eq('id', id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw new Error('Invitation cleanup failed');
    return Boolean(data);
  },

  async sendInvitationEmail(input: { to: string; acceptanceUrl: string; role: 'editor' | 'viewer' }): Promise<void> {
    const safeUrl = input.acceptanceUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const roleName = input.role === 'editor' ? 'editor' : 'viewer';
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: emailFrom,
          to: [input.to],
          subject: 'You are invited to a TravelMate trip',
          text: `You have been invited to join a TravelMate trip as a ${roleName}. Accept the invitation: ${input.acceptanceUrl}`,
          html: `<p>You have been invited to join a TravelMate trip as a ${roleName}.</p><p><a href="${safeUrl}">Accept invitation</a></p><p>This link expires in 7 days and can be used once.</p>`,
        }),
      });
    } catch {
      throw new EmailDeliveryError('unknown');
    }
    if (!response.ok) throw new EmailDeliveryError(response.status >= 500 ? 'unknown' : 'rejected');
  },
};

const handler = createTripInvitationHandler(dependencies, {
  appUrl,
  allowedOrigins,
  ready,
});

Deno.serve(handler);
