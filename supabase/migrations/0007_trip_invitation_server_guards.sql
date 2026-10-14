-- Server-only helpers for invitation recipient checks and durable rate limiting.
-- Review and apply manually before deploying create-trip-invitation. No browser
-- role can execute these helpers or access the rate-limit table directly.

begin;

create table public.trip_invitation_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

alter table public.trip_invitation_rate_limits enable row level security;
revoke all on table public.trip_invitation_rate_limits from public, anon, authenticated, service_role;

-- Return only whether this exact email currently belongs to a member of this
-- trip. This avoids exposing Auth user enumeration to the browser/API caller.
create function public.trip_has_member_email(target_trip uuid, target_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from auth.users as u
    join public.trip_members as m on m.user_id = u.id
    where m.trip_id = target_trip
      and pg_catalog.lower(pg_catalog.btrim(u.email)) = pg_catalog.lower(pg_catalog.btrim(target_email))
  );
$function$;

alter function public.trip_has_member_email(uuid, text) owner to postgres;
revoke all on function public.trip_has_member_email(uuid, text) from public, anon, authenticated;
grant execute on function public.trip_has_member_email(uuid, text) to service_role;

-- Atomic fixed-window limiter: at most 10 valid invitation attempts per owner
-- per one-hour window. The stored counter saturates at 11 (the first denied
-- attempt), and the single-row upsert serializes concurrent requests.
create function public.consume_trip_invitation_rate_limit(target_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_at timestamptz := pg_catalog.clock_timestamp();
  current_count integer;
begin
  if target_user is null then
    raise exception using errcode = '22023', message = 'User is required.';
  end if;

  insert into public.trip_invitation_rate_limits as current_limit (
    user_id, window_started_at, request_count
  ) values (target_user, current_at, 1)
  on conflict (user_id) do update
  set
    window_started_at = case
      when current_limit.window_started_at <= current_at - interval '1 hour' then current_at
      else current_limit.window_started_at
    end,
    request_count = case
      when current_limit.window_started_at <= current_at - interval '1 hour' then 1
      when current_limit.request_count < 11 then current_limit.request_count + 1
      else 11
    end
  returning request_count into current_count;

  return current_count <= 10;
end;
$function$;

alter function public.consume_trip_invitation_rate_limit(uuid) owner to postgres;
revoke all on function public.consume_trip_invitation_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.consume_trip_invitation_rate_limit(uuid) to service_role;

commit;
