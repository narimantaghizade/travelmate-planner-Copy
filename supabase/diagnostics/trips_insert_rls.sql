-- Read-only diagnostics for the trips RLS error.
-- Run in Supabase SQL Editor. Do not treat auth.uid() here as the browser user:
-- SQL Editor runs with its own database role/context, not the app's JWT.

-- 1. Inspect public.trips columns, types, nullability, and defaults.
select
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default,
  is_identity,
  is_generated
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trips'
order by ordinal_position;

-- 2. Inspect table existence, RLS/force-RLS flags, and owner.
select
  n.nspname as schema_name,
  c.relname as table_name,
  pg_get_userbyid(c.relowner) as table_owner,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'trips'
  and c.relkind in ('r', 'p');

-- 3. Inspect every trips policy. A permissive INSERT or ALL policy can change
-- how the net RLS rule behaves; PostgreSQL combines permissive policies with OR.
select
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as check_expression
from pg_policies
where schemaname = 'public'
  and tablename = 'trips'
order by cmd, policyname;

-- 4. Inspect grants separately from RLS policies.
select grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'trips'
  and grantee in ('anon', 'authenticated', 'service_role')
order by grantee, privilege_type;

-- 5. Inspect owner_id foreign keys/checks and related triggers.
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.trips'::regclass
order by conname;

select trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'trips'
order by trigger_name, event_manipulation;

-- Diagnostic for SQL Editor context only; auth.uid() is usually NULL there.
-- Browser authentication must be checked through Supabase Auth in the app.
select current_user as sql_editor_role, auth.uid() as sql_editor_auth_uid, auth.role() as sql_editor_auth_role;
