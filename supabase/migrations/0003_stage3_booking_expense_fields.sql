-- Incremental Stage 3 schema additions for structured bookings and expenses.
-- Review and run manually in the Supabase SQL Editor. This migration does not
-- change RLS policies, triggers, foreign keys, or any other database objects.

begin;

alter table public.bookings
  add column if not exists provider text not null default '',
  add column if not exists booking_url text not null default '',
  add column if not exists status text not null default 'planned';

-- Keep definitions correct if one of these columns was added before this migration.
alter table public.bookings
  alter column provider set default '',
  alter column provider set not null,
  alter column booking_url set default '',
  alter column booking_url set not null,
  alter column status set default 'planned',
  alter column status set not null;

-- Replace the deployed kind constraint with the requested supported kinds.
alter table public.bookings
  drop constraint if exists bookings_kind_check;

alter table public.bookings
  add constraint bookings_kind_check
  check (kind in (
    'Flight', 'Accommodation', 'Ticket', 'Activity', 'Restaurant',
    'Transfer', 'Transport', 'Parking', 'Other'
  ));

-- Recreate the named constraint so rerunning this migration remains safe.
alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in ('planned', 'confirmed', 'cancelled', 'completed'));

alter table public.expenses
  add column if not exists category text not null default 'Other';

alter table public.expenses
  alter column category set default 'Other',
  alter column category set not null;

alter table public.expenses
  drop constraint if exists expenses_category_nonblank;

alter table public.expenses
  add constraint expenses_category_nonblank
  check (length(trim(category)) > 0);

commit;
