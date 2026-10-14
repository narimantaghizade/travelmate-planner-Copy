import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('./0005_trip_collaboration_invitations.sql', import.meta.url), 'utf8');

describe('private trip invitation migration', () => {
  it('defines the private invitation fields and restricts roles and state', () => {
    expect(migration).toMatch(/create table public\.trip_invitations[\s\S]*?trip_id uuid not null references public\.trips\(id\) on delete cascade/i);
    expect(migration).toMatch(/invited_email text not null/i);
    expect(migration).toMatch(/invited_role text not null/i);
    expect(migration).toMatch(/token_hash bytea not null/i);
    expect(migration).toMatch(/invited_by uuid not null references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/expires_at timestamptz not null/i);
    expect(migration).toMatch(/accepted_at timestamptz/i);
    expect(migration).toMatch(/revoked_at timestamptz/i);
    expect(migration).toMatch(/invited_role in \('editor', 'viewer'\)/i);
    expect(migration).toMatch(/octet_length\(token_hash\) = 32/i);
    expect(migration).toMatch(/not \(accepted_at is not null and revoked_at is not null\)/i);
    expect(migration).toMatch(/expires_at > created_at/i);
  });

  it('keeps invitation records inaccessible to browser roles and adds no RLS policy', () => {
    expect(migration).toMatch(/alter table public\.trip_invitations enable row level security/i);
    expect(migration).toMatch(/revoke all on table public\.trip_invitations from public, anon, authenticated/i);
    expect(migration).toMatch(/grant select, insert, update, delete on table public\.trip_invitations to service_role/i);
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/\bgrant\b[^;]*\bto\s+(?:anon|authenticated|public)\b/i);
  });

  it('adds token, trip, expiry, and pending-invitation indexes without changing membership or Storage', () => {
    expect(migration).toMatch(/constraint trip_invitations_token_hash_unique unique \(token_hash\)/i);
    expect(migration).toMatch(/create index trip_invitations_trip_created_idx/i);
    expect(migration).toMatch(/create index trip_invitations_expiry_idx/i);
    expect(migration).toMatch(/create unique index trip_invitations_one_pending_email_per_trip/i);
    expect(migration).not.toMatch(/(?:alter|create|drop)\s+[^;]*\btrip_members\b/i);
    expect(migration).not.toMatch(/storage\.(?:buckets|objects)/i);
  });
});
