-- Incremental repair for an existing Supabase database.
-- Review the output of supabase/diagnostics/trips_insert_rls.sql first.
-- This does not change trip data, disable RLS, or permit public trip inserts.
-- If an existing FOR ALL policy provided SELECT/UPDATE/DELETE access, recreate
-- those permissions as separate policies after reviewing the live policy output.

begin;

do $$
declare
  insert_policy record;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trips'
      and column_name = 'owner_id'
      and udt_name = 'uuid'
  ) then
    raise exception 'Expected public.trips.owner_id UUID column. Inspect the live schema and prepare a schema-specific upgrade before applying this policy migration.';
  end if;

  -- RLS policies are permissive by default and can combine to allow an insert.
  -- Remove only INSERT/ALL policies that can apply to anon/authenticated/public.
  for insert_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'trips'
      and cmd in ('INSERT', 'ALL')
      and (
        roles @> array['authenticated']::name[]
        or roles @> array['anon']::name[]
        or roles @> array['public']::name[]
      )
  loop
    execute format('drop policy %I on public.trips', insert_policy.policyname);
  end loop;
end $$;

alter table public.trips enable row level security;
grant insert on table public.trips to authenticated;

create policy trips_insert_owned_by_authenticated_user
  on public.trips
  as permissive
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and owner_id = (select auth.uid())
  );

commit;
