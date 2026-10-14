-- Read-only diagnostics for the deployed trips RLS context.
-- Run in the Supabase SQL Editor for the project you intend to inspect.
-- Every database statement below is SELECT-only; no DDL or DML is performed.

-- 1. Confirm that public.trips exists and report its RLS flags.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'trips'
  and c.relkind in ('r', 'p');

-- 2. Show every deployed policy on public.trips, including command, roles,
-- permissive/restrictive mode, USING, and WITH CHECK expressions.
-- For INSERT, policies with cmd = INSERT or ALL may apply. Permissive policies
-- combine with OR; restrictive policies combine with AND.
select
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as check_expression,
  (cmd in ('INSERT', 'ALL')) as applies_to_insert_command,
  (
    cmd in ('INSERT', 'ALL')
    and (
      'authenticated' = any(roles)
      or 'public' = any(roles)
    )
  ) as can_apply_to_authenticated_insert
from pg_policies
where schemaname = 'public'
  and tablename = 'trips'
order by cmd, policyname;

-- 3. Show the deployed auth.uid() implementation and function settings.
select
  p.oid::regprocedure as function_signature,
  pg_get_userbyid(p.proowner) as function_owner,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as deployed_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'auth'
  and p.proname = 'uid'
  and p.pronargs = 0;

-- 4. Show the SQL Editor's current database role and auth.uid() result.
-- SQL Editor does not run with the failing browser request's JWT, so a NULL
-- auth.uid() here does not prove that the browser request had no user session.
select
  current_user as sql_editor_database_role,
  auth.uid() as sql_editor_auth_uid;

-- 5. Compare project refs manually. Get the browser ref from the host in the
-- failing Network request URL, e.g. https://<ref>.supabase.co/rest/v1/trips.
-- Get the SQL Editor ref from the project URL shown in the Supabase Dashboard.
-- Replace both placeholders below; this compares the two supplied refs only.
with supplied_refs as (
  select
    'PASTE_BROWSER_REQUEST_PROJECT_REF'::text as browser_project_ref,
    'PASTE_SQL_EDITOR_PROJECT_REF'::text as sql_editor_project_ref
)
select
  browser_project_ref,
  sql_editor_project_ref,
  browser_project_ref = sql_editor_project_ref as refs_match
from supplied_refs;
