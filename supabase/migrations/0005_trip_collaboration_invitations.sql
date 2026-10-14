-- Private records for the future server-mediated trip invitation flow.
-- Invitation creation, acceptance, email delivery, and membership writes are
-- intentionally not implemented by this migration.

begin;

create table public.trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  invited_email text not null,
  invited_role text not null,
  -- Store a SHA-256 token digest (32 raw bytes), never the invitation token.
  token_hash bytea not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  constraint trip_invitations_email_normalized
    check (length(invited_email) > 0 and invited_email = lower(btrim(invited_email))),
  constraint trip_invitations_role_allowed
    check (invited_role in ('editor', 'viewer')),
  constraint trip_invitations_token_hash_sha256
    check (octet_length(token_hash) = 32),
  constraint trip_invitations_expiry_after_creation
    check (expires_at > created_at),
  constraint trip_invitations_state_valid
    check (
      not (accepted_at is not null and revoked_at is not null)
      and (accepted_at is null or (accepted_at >= created_at and accepted_at <= expires_at))
      and (revoked_at is null or revoked_at >= created_at)
    ),
  constraint trip_invitations_token_hash_unique unique (token_hash)
);

create index trip_invitations_trip_created_idx
  on public.trip_invitations (trip_id, created_at desc);

create index trip_invitations_expiry_idx
  on public.trip_invitations (expires_at)
  where accepted_at is null and revoked_at is null;

-- At most one unaccepted and unrevoked invitation per trip/email. Expired
-- invitations still occupy this slot until a trusted server flow revokes them.
create unique index trip_invitations_one_pending_email_per_trip
  on public.trip_invitations (trip_id, invited_email)
  where accepted_at is null and revoked_at is null;

alter table public.trip_invitations enable row level security;

-- No browser role can read or mutate invitation tokens or records. Future
-- server-side code may use the Supabase service_role; never expose it to Vite.
revoke all on table public.trip_invitations from public, anon, authenticated;
grant select, insert, update, delete on table public.trip_invitations to service_role;

commit;
