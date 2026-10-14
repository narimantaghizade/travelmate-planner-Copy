-- Private Storage bucket and trip-scoped object access for TravelMate documents.
-- Review and apply manually. This migration does not alter existing public-table
-- policies, trip membership functions, triggers, or trip data.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'trip-documents',
  'trip-documents',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
);

-- Object paths begin with the trip UUID. CASE prevents malformed first path
-- segments from being cast to UUID; all other segments remain opaque object
-- path data. No UPDATE policy is created, so clients cannot overwrite objects.
create policy "trip documents members read objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trip-documents'
  and case
    when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.is_trip_member(split_part(name, '/', 1)::uuid)
    else false
  end
);

create policy "trip editors upload document objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trip-documents'
  and case
    when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_edit_trip(split_part(name, '/', 1)::uuid)
    else false
  end
);

create policy "trip editors delete document objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'trip-documents'
  and case
    when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_edit_trip(split_part(name, '/', 1)::uuid)
    else false
  end
);

commit;
