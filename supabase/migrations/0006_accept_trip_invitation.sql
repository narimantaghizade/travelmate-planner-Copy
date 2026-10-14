-- Atomic acceptance for invitations created by a future trusted server flow.
-- Review and apply manually. This does not enable direct trip_members writes.

begin;

create or replace function public.accept_trip_invitation(invitation_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  invitation public.trip_invitations%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Sign in before accepting an invitation.';
  end if;

  -- Only a confirmed Auth email may be used to match an invitation.
  select pg_catalog.lower(pg_catalog.btrim(u.email))
    into caller_email
  from auth.users as u
  where u.id = caller_id
    and u.email_confirmed_at is not null;

  if caller_email is null
     or invitation_token is null
     or pg_catalog.length(invitation_token) < 32
     or pg_catalog.length(invitation_token) > 256 then
    raise exception using errcode = '22023',
      message = 'Invitation is invalid, expired, revoked, or unavailable for this account.';
  end if;

  -- Locking the invitation serializes concurrent acceptance attempts. The
  -- digest is compared in its stored 32-byte form; the raw token is not saved.
  select i.*
    into invitation
  from public.trip_invitations as i
  where i.token_hash = extensions.digest(
    pg_catalog.convert_to(invitation_token, 'UTF8'),
    'sha256'
  )
  for update;

  if not found
     or invitation.invited_email <> caller_email
     or invitation.expires_at <= pg_catalog.clock_timestamp()
     or invitation.accepted_at is not null
     or invitation.revoked_at is not null then
    raise exception using errcode = '22023',
      message = 'Invitation is invalid, expired, revoked, or unavailable for this account.';
  end if;

  -- Preserve an existing membership and role; this only adds the invite role
  -- when the user is not already a member. The trip_members PK prevents dupes.
  insert into public.trip_members (trip_id, user_id, role)
  values (invitation.trip_id, caller_id, invitation.invited_role)
  on conflict (trip_id, user_id) do nothing;

  update public.trip_invitations
  set accepted_at = pg_catalog.clock_timestamp()
  where id = invitation.id;

  return invitation.trip_id;
end;
$function$;

alter function public.accept_trip_invitation(text) owner to postgres;

revoke all on function public.accept_trip_invitation(text) from public, anon, authenticated;
grant execute on function public.accept_trip_invitation(text) to authenticated;

commit;
