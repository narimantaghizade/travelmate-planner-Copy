-- TravelMate schema for a NEW Supabase project. Review before applying.
-- Browser access uses only the publishable/anon key plus a Supabase Auth session.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id text,
  name text not null check (length(trim(name)) > 0),
  city text not null default '',
  start_date date,
  end_date date,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_dates_valid check (start_date is null or end_date is null or end_date >= start_date),
  constraint trips_owner_client_unique unique(owner_id, client_id),
  constraint trips_id_owner_unique unique(id, owner_id)
);

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  client_id text,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'Attraction',
  address text not null default '',
  planned_date date,
  planned_time time,
  duration_minutes integer not null default 60 check (duration_minutes >= 0),
  notes text not null default '',
  priority text not null default 'Must visit' check (priority in ('Must visit','Optional','Backup')),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  estimated_cost numeric(12,2) not null default 0 check (estimated_cost >= 0),
  visited boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint destinations_trip_client_unique unique(trip_id, client_id),
  constraint destinations_id_trip_unique unique(id, trip_id)
);

-- Explicit day/sequence rows keep itinerary ordering independent from saved places.
create table public.itinerary_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  destination_id uuid,
  entry_date date,
  starts_at time,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  title text not null default '',
  notes text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint itinerary_destination_same_trip_fk foreign key(destination_id, trip_id)
    references public.destinations(id, trip_id) on delete cascade
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  client_id text,
  kind text not null check (kind in ('Flight','Accommodation','Ticket','Restaurant','Transfer','Other')),
  title text not null check (length(trim(title)) > 0),
  booking_date date,
  local_time time,
  reference text not null default '',
  address text not null default '',
  estimated_cost numeric(12,2) not null default 0 check (estimated_cost >= 0),
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_trip_client_unique unique(trip_id, client_id),
  constraint bookings_id_trip_unique unique(id, trip_id)
);

create table public.flights (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  booking_id uuid not null,
  airline text not null default '',
  flight_number text not null default '',
  departure_airport text not null default '',
  arrival_airport text not null default '',
  departure_at timestamptz,
  arrival_at timestamptz,
  constraint flights_booking_same_trip_fk foreign key(booking_id, trip_id)
    references public.bookings(id, trip_id) on delete cascade
);

create table public.accommodations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  booking_id uuid not null,
  property_name text not null default '',
  check_in_at timestamptz,
  check_out_at timestamptz,
  address text not null default '',
  constraint accommodations_booking_same_trip_fk foreign key(booking_id, trip_id)
    references public.bookings(id, trip_id) on delete cascade
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  booking_id uuid,
  destination_id uuid,
  title text not null check (length(trim(title)) > 0),
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  spent_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint expenses_booking_same_trip_fk foreign key(booking_id, trip_id)
    references public.bookings(id, trip_id) on delete set null (booking_id),
  constraint expenses_destination_same_trip_fk foreign key(destination_id, trip_id)
    references public.destinations(id, trip_id) on delete set null (destination_id)
);

-- Metadata only. Storage objects must live in a PRIVATE bucket with separate Storage RLS.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  booking_id uuid,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  constraint documents_booking_same_trip_fk foreign key(booking_id, trip_id)
    references public.bookings(id, trip_id) on delete set null (booking_id)
);

create index destinations_trip_date_idx on public.destinations(trip_id, planned_date, planned_time);
create index itinerary_trip_date_idx on public.itinerary_entries(trip_id, entry_date, sort_order);
create index bookings_trip_date_idx on public.bookings(trip_id, booking_date, local_time);
create index trip_members_user_idx on public.trip_members(user_id);

-- SECURITY DEFINER avoids recursive RLS evaluation. Pin search_path and limit execution.
create function public.is_trip_member(target_trip uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.trip_members m where m.trip_id = target_trip and m.user_id = (select auth.uid())) $$;

create function public.can_edit_trip(target_trip uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.trip_members m where m.trip_id = target_trip and m.user_id = (select auth.uid()) and m.role in ('owner','editor')) $$;

create function public.is_trip_owner(target_trip uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.trip_members m where m.trip_id = target_trip and m.user_id = (select auth.uid()) and m.role = 'owner') $$;

revoke all on function public.is_trip_member(uuid), public.can_edit_trip(uuid), public.is_trip_owner(uuid) from public, anon;
grant execute on function public.is_trip_member(uuid), public.can_edit_trip(uuid), public.is_trip_owner(uuid) to authenticated;

create function public.add_trip_owner_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.trip_members(trip_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create function public.protect_trip_owner()
returns trigger language plpgsql set search_path = ''
as $$ begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Trip owner cannot be changed';
  end if;
  new.updated_at = now();
  return new;
end $$;

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

create trigger trips_add_owner_membership after insert on public.trips
  for each row execute function public.add_trip_owner_membership();
create trigger trips_protect_owner before update on public.trips
  for each row execute function public.protect_trip_owner();
create trigger destinations_touch_updated_at before update on public.destinations
  for each row execute function public.touch_updated_at();
create trigger bookings_touch_updated_at before update on public.bookings
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.destinations enable row level security;
alter table public.itinerary_entries enable row level security;
alter table public.bookings enable row level security;
alter table public.flights enable row level security;
alter table public.accommodations enable row level security;
alter table public.expenses enable row level security;
alter table public.documents enable row level security;

-- SQL grants permit API operations; RLS below decides which rows each user can touch.
grant select, insert, update on public.profiles to authenticated;
grant select on public.trip_members to authenticated;
grant select, insert, update, delete on public.trips, public.destinations, public.itinerary_entries,
  public.bookings, public.flights, public.accommodations, public.expenses, public.documents to authenticated;

create policy "profiles read own" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles update own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members read trip" on public.trip_members for select to authenticated using (public.is_trip_member(trip_id));
-- Membership writes stay disabled for browser roles. Add a vetted invitation RPC/Edge Function later.

create policy "trips visible to members" on public.trips for select to authenticated using (public.is_trip_member(id));
create policy "users create owned trips" on public.trips for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "editors update trips" on public.trips for update to authenticated using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));
create policy "owners delete trips" on public.trips for delete to authenticated using (public.is_trip_owner(id));

create policy "destinations members read" on public.destinations for select to authenticated using (public.is_trip_member(trip_id));
create policy "destinations editors insert" on public.destinations for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy "destinations editors update" on public.destinations for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy "destinations editors delete" on public.destinations for delete to authenticated using (public.can_edit_trip(trip_id));

create policy "itinerary members read" on public.itinerary_entries for select to authenticated using (public.is_trip_member(trip_id));
create policy "itinerary editors insert" on public.itinerary_entries for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy "itinerary editors update" on public.itinerary_entries for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy "itinerary editors delete" on public.itinerary_entries for delete to authenticated using (public.can_edit_trip(trip_id));

create policy "bookings members read" on public.bookings for select to authenticated using (public.is_trip_member(trip_id));
create policy "bookings editors insert" on public.bookings for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy "bookings editors update" on public.bookings for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy "bookings editors delete" on public.bookings for delete to authenticated using (public.can_edit_trip(trip_id));

create policy "flights members read" on public.flights for select to authenticated using (public.is_trip_member(trip_id));
create policy "flights editors insert" on public.flights for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy "flights editors update" on public.flights for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy "flights editors delete" on public.flights for delete to authenticated using (public.can_edit_trip(trip_id));
create policy "accommodations members read" on public.accommodations for select to authenticated using (public.is_trip_member(trip_id));
create policy "accommodations editors insert" on public.accommodations for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy "accommodations editors update" on public.accommodations for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy "accommodations editors delete" on public.accommodations for delete to authenticated using (public.can_edit_trip(trip_id));

create policy "expenses members read" on public.expenses for select to authenticated using (public.is_trip_member(trip_id));
create policy "expenses editors insert" on public.expenses for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy "expenses editors update" on public.expenses for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy "expenses editors delete" on public.expenses for delete to authenticated using (public.can_edit_trip(trip_id));

create policy "documents members read metadata" on public.documents for select to authenticated using (public.is_trip_member(trip_id));
create policy "documents editors insert metadata" on public.documents for insert to authenticated with check (public.can_edit_trip(trip_id) and uploaded_by = (select auth.uid()));
create policy "documents editors delete metadata" on public.documents for delete to authenticated using (public.can_edit_trip(trip_id));

-- Create a PRIVATE `trip-documents` bucket later. Store objects beneath <trip-uuid>/...
-- Add Storage RLS only after validating the path and checking trip membership.
