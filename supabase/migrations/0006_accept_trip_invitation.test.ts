import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('./0006_accept_trip_invitation.sql', import.meta.url), 'utf8');

describe('atomic trip invitation acceptance migration', () => {
  it('uses a fixed search path and limits function execution to authenticated users', () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/i);
    expect(migration).toMatch(/alter function public\.accept_trip_invitation\(text\) owner to postgres/i);
    expect(migration).toMatch(/revoke all on function public\.accept_trip_invitation\(text\) from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.accept_trip_invitation\(text\) to authenticated/i);
    expect(migration).not.toMatch(/grant\s+[^;]*\bto\s+(?:anon|public)\b/i);
  });

  it('requires the verified current user email and checks invitation validity', () => {
    expect(migration).toContain('caller_id uuid := auth.uid()');
    expect(migration).toMatch(/u\.email_confirmed_at is not null/i);
    expect(migration).toContain('invitation.invited_email <> caller_email');
    expect(migration).toContain('invitation.expires_at <= pg_catalog.clock_timestamp()');
    expect(migration).toContain('invitation.accepted_at is not null');
    expect(migration).toContain('invitation.revoked_at is not null');
    expect(migration).toMatch(/extensions\.digest\([\s\S]*?'sha256'/i);
    expect(migration).toContain('pg_catalog.convert_to(invitation_token,');
  });

  it('locks the invitation and adds membership and marks acceptance in one transaction', () => {
    expect(migration).toMatch(/from public\.trip_invitations as i[\s\S]*?for update/i);
    expect(migration).toMatch(/insert into public\.trip_members[\s\S]*?on conflict \(trip_id, user_id\) do nothing/i);
    expect(migration).toMatch(/update public\.trip_invitations[\s\S]*?set accepted_at/i);
    expect(migration).not.toMatch(/grant\s+[^;]*on\s+public\.trip_members/i);
    expect(migration).not.toMatch(/create policy|alter policy|drop policy/i);
  });
});
