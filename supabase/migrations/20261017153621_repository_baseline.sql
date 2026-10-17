begin;

create extension if not exists pgcrypto;

create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  center jsonb,
  google_place_id text,
  zoom integer not null check (zoom between 0 and 22),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (google_place_id is not null and btrim(google_place_id) <> '')
    or center is not null
  ),
  check (
    center is null
    or (
      jsonb_typeof(center) = 'object'
      and center ? 'latitude'
      and center ? 'longitude'
      and ((center->>'latitude')::double precision between -90 and 90)
      and ((center->>'longitude')::double precision between -180 and 180)
    )
  )
);

alter table public.regions
  alter column id set default gen_random_uuid();

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  color text not null check (btrim(color) <> ''),
  parent_id uuid references public.labels (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  icon text,
  maps_url text,
  google_place_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (google_place_id is not null and btrim(google_place_id) <> '')
    or (maps_url is not null and btrim(maps_url) <> '')
  ),
  check (
    maps_url is null
    or maps_url ~* '^https?://'
  )
);

create table if not exists public.place_regions (
  place_id uuid not null references public.places (id) on delete cascade,
  region_id uuid not null references public.regions (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (place_id, region_id)
);

create index if not exists place_regions_region_id_idx
  on public.place_regions (region_id);

create table if not exists public.place_labels (
  place_id uuid not null references public.places (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (place_id, label_id)
);

create index if not exists place_labels_label_id_idx
  on public.place_labels (label_id);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  start_date date not null,
  end_date date not null,
  owner_uid uuid not null,
  edit_mode text not null default 'private' check (edit_mode in ('private', 'shared')),
  editor_uids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists trips_region_id_idx
  on public.trips (region_id);

create index if not exists trips_start_date_idx
  on public.trips (start_date);

create table if not exists public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete restrict,
  date date not null,
  arrival_time text,
  duration_minutes integer,
  transport text,
  travel_duration_minutes integer,
  note text,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sort_order >= 0),
  check (arrival_time is null or arrival_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  check (duration_minutes is null or duration_minutes > 0),
  check (travel_duration_minutes is null or travel_duration_minutes >= 0),
  unique (trip_id, date, sort_order)
);

create index if not exists itinerary_items_trip_id_idx
  on public.itinerary_items (trip_id);

create index if not exists itinerary_items_place_id_idx
  on public.itinerary_items (place_id);

create index if not exists itinerary_items_trip_date_order_idx
  on public.itinerary_items (trip_id, date, sort_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_regions on public.regions;
create trigger set_updated_at_regions
before update on public.regions
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_labels on public.labels;
create trigger set_updated_at_labels
before update on public.labels
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_places on public.places;
create trigger set_updated_at_places
before update on public.places
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_trips on public.trips;
create trigger set_updated_at_trips
before update on public.trips
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_itinerary_items on public.itinerary_items;
create trigger set_updated_at_itinerary_items
before update on public.itinerary_items
for each row execute function public.set_updated_at();

create or replace function public.prevent_label_cycle()
returns trigger
language plpgsql
as $$
declare
  current_parent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Label hierarchy must not contain a cycle.';
  end if;

  current_parent := new.parent_id;
  while current_parent is not null loop
    if current_parent = new.id then
      raise exception 'Label hierarchy must not contain a cycle.';
    end if;

    select parent_id into current_parent
    from public.labels
    where id = current_parent;
  end loop;

  return new;
end;
$$;

drop trigger if exists prevent_label_cycle_tg on public.labels;
create trigger prevent_label_cycle_tg
before insert or update of parent_id on public.labels
for each row execute function public.prevent_label_cycle();

create or replace function public.ensure_itinerary_date_within_trip()
returns trigger
language plpgsql
as $$
declare
  trip_start date;
  trip_end date;
begin
  select start_date, end_date
  into trip_start, trip_end
  from public.trips
  where id = new.trip_id;

  if trip_start is null then
    raise exception 'Trip % does not exist.', new.trip_id;
  end if;

  if new.date < trip_start or new.date > trip_end then
    raise exception 'Itinerary item date must be within the trip dates.';
  end if;

  return new;
end;
$$;

drop trigger if exists itinerary_item_trip_date_guard on public.itinerary_items;
create trigger itinerary_item_trip_date_guard
before insert or update of trip_id, date on public.itinerary_items
for each row execute function public.ensure_itinerary_date_within_trip();

create or replace function public.prevent_trip_range_shrink()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.itinerary_items items
    where items.trip_id = new.id
      and (items.date < new.start_date or items.date > new.end_date)
  ) then
    raise exception 'Trip dates cannot exclude an existing itinerary item.';
  end if;

  return new;
end;
$$;

create or replace function public.set_trip_owner_if_missing()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.owner_uid is null then
    new.owner_uid := auth.uid();
  end if;

  if new.owner_uid is null then
    raise exception 'Trip owner_uid is required.';
  end if;

  if new.edit_mode is null then
    new.edit_mode := 'private';
  end if;

  if new.editor_uids is null then
    new.editor_uids := '{}'::uuid[];
  end if;

  return new;
end;
$$;

create or replace function public.can_edit_trip(p_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and (
        public.app_is_member()
        and (t.owner_uid = auth.uid() or public.app_is_admin())
      )
  );
end;
$$;

create or replace function public.can_manage_trip_acl(p_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and public.app_is_member()
      and (t.owner_uid = auth.uid() or public.app_is_admin())
  );
end;
$$;

create or replace function public.app_reorder_itinerary_items(
  p_trip_id uuid,
  p_date date,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  day_count integer;
  input_count integer;
  unique_input_count integer;
  max_order integer;
begin
  if uid is null then
    raise exception '請先登入。';
  end if;

  if not public.app_is_member() then
    raise exception '目前沒有權限執行此操作。';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception '目前沒有權限編輯此行程。';
  end if;

  input_count := coalesce(array_length(p_ordered_ids, 1), 0);

  select count(*)::integer, coalesce(max(sort_order), -1)
    into day_count, max_order
  from public.itinerary_items
  where trip_id = p_trip_id
    and date = p_date;

  select count(distinct item_id)::integer
    into unique_input_count
  from unnest(coalesce(p_ordered_ids, '{}'::uuid[])) as input(item_id);

  if input_count <> day_count or unique_input_count <> input_count then
    raise exception 'The reordered itinerary items do not match this trip day.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_ordered_ids, '{}'::uuid[])) as input(item_id)
    left join public.itinerary_items items
      on items.id = input.item_id
     and items.trip_id = p_trip_id
     and items.date = p_date
    where items.id is null
  ) then
    raise exception 'The reordered itinerary items do not match this trip day.';
  end if;

  with ordered as (
    select item_id as id, ordinality::integer - 1 as target_order
    from unnest(p_ordered_ids) with ordinality as input(item_id, ordinality)
  ),
  previous_before as (
    select
      items.id,
      lag(items.place_id) over (order by items.sort_order) as previous_place_id
    from public.itinerary_items items
    where items.trip_id = p_trip_id
      and items.date = p_date
  ),
  previous_after as (
    select
      items.id,
      lag(items.place_id) over (order by ordered.target_order) as previous_place_id
    from public.itinerary_items items
    join ordered on ordered.id = items.id
  ),
  temporary_order as (
    update public.itinerary_items items
    set sort_order = max_order + 1 + ordered.target_order
    from ordered
    where items.id = ordered.id
    returning items.id
  )
  update public.itinerary_items items
  set sort_order = ordered.target_order,
      travel_duration_minutes = case
        when previous_before.previous_place_id is distinct from previous_after.previous_place_id then null
        else items.travel_duration_minutes
      end
  from ordered
  join previous_before on previous_before.id = ordered.id
  join previous_after on previous_after.id = ordered.id
  where items.id = ordered.id;
end;
$$;

create or replace function public.prevent_non_owner_acl_changes()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.owner_uid is distinct from old.owner_uid then
    raise exception 'Changing a trip owner is not supported.';
  end if;
  if old.owner_uid is distinct from auth.uid() and not public.app_is_admin() then
    if (
      new.owner_uid is distinct from old.owner_uid
      or new.edit_mode is distinct from old.edit_mode
      or new.editor_uids is distinct from old.editor_uids
    ) then
      raise exception 'Only the trip owner may change ACL fields.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.can_edit_trip(uuid) from public;
grant execute on function public.can_edit_trip(uuid) to authenticated;

revoke all on function public.can_manage_trip_acl(uuid) from public;
grant execute on function public.can_manage_trip_acl(uuid) to authenticated;

revoke all on function public.app_reorder_itinerary_items(uuid, date, uuid[]) from public;
grant execute on function public.app_reorder_itinerary_items(uuid, date, uuid[]) to authenticated;

drop trigger if exists prevent_trip_range_shrink_tg on public.trips;
create trigger prevent_trip_range_shrink_tg
before update of start_date, end_date on public.trips
for each row execute function public.prevent_trip_range_shrink();

drop trigger if exists set_trip_owner_on_insert on public.trips;
create trigger set_trip_owner_on_insert
before insert on public.trips
for each row execute function public.set_trip_owner_if_missing();

drop trigger if exists prevent_non_owner_acl_changes_tg on public.trips;
create trigger prevent_non_owner_acl_changes_tg
before update on public.trips
for each row execute function public.prevent_non_owner_acl_changes();

alter table public.regions enable row level security;
alter table public.labels enable row level security;
alter table public.places enable row level security;
alter table public.place_regions enable row level security;
alter table public.place_labels enable row level security;
alter table public.trips enable row level security;
alter table public.itinerary_items enable row level security;

revoke all on public.regions from anon;
revoke all on public.labels from anon;
revoke all on public.places from anon;
revoke all on public.place_regions from anon;
revoke all on public.place_labels from anon;
revoke all on public.trips from anon;
revoke all on public.itinerary_items from anon;

grant select, insert, update, delete on public.regions to authenticated;
grant select, insert, update, delete on public.labels to authenticated;
grant select, insert, update, delete on public.places to authenticated;
grant select, insert, update, delete on public.place_regions to authenticated;
grant select, insert, update, delete on public.place_labels to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert, update, delete on public.itinerary_items to authenticated;

drop policy if exists regions_authenticated_all on public.regions;
-- No broad authenticated policies are installed by this schema bootstrap.
-- Apply supabase-basic-role-rls.sql and supabase-owner-isolation.sql next.
-- Remove previous broad policies on upgrades; owner-isolation policies survive reruns.
drop policy if exists labels_authenticated_all on public.labels;
drop policy if exists places_authenticated_all on public.places;
drop policy if exists place_regions_authenticated_all on public.place_regions;
drop policy if exists place_labels_authenticated_all on public.place_labels;
drop policy if exists trips_authenticated_all on public.trips;
drop policy if exists authenticated_read_trips on public.trips;
drop policy if exists owner_create_trips on public.trips;
drop policy if exists editors_update_trips on public.trips;
drop policy if exists owner_delete_trips on public.trips;
drop policy if exists itinerary_items_authenticated_all on public.itinerary_items;
drop policy if exists authenticated_read_itinerary_items on public.itinerary_items;
drop policy if exists editors_insert_itinerary_items on public.itinerary_items;
drop policy if exists editors_update_itinerary_items on public.itinerary_items;
drop policy if exists editors_delete_itinerary_items on public.itinerary_items;

commit;

-- Supabase RBAC bootstrap for signup-based default basic role
-- Goal:
-- 1) New signup users are assigned role=basic
-- 2) Member accesses own business data; admin accesses all business data
-- 3) Admin can manage role assignments

begin;

-- 1) Role table
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('basic', 'member', 'admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_user_roles_role on public.user_roles(role);

-- Keep updated_at current
create or replace function public.set_updated_at_user_roles()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_user_roles_set_updated_at on public.user_roles;
create trigger trg_user_roles_set_updated_at
before update on public.user_roles
for each row
execute function public.set_updated_at_user_roles();

-- 2) Assign default role=basic on signup
create or replace function public.handle_new_auth_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles(user_id, role)
  values (new.id, 'basic')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created_set_role on auth.users;
create trigger trg_on_auth_user_created_set_role
after insert on auth.users
for each row
execute function public.handle_new_auth_user_role();

-- Backfill existing users that do not have a role yet
insert into public.user_roles(user_id, role)
select u.id, 'member'
from auth.users u
left join public.user_roles r on r.user_id = u.id
where r.user_id is null;

-- 3) Helper functions for RLS
create or replace function public.app_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.user_roles
  where user_id = auth.uid();
$$;

create or replace function public.app_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() in ('member', 'admin'), false);
$$;

create or replace function public.app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() = 'admin', false);
$$;

-- 4) RLS for user_roles
alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon;
grant select, insert, update, delete on public.user_roles to authenticated;

-- Drop all existing policies on user_roles to avoid permissive leftovers
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'user_roles'
  LOOP
    execute format('drop policy if exists %I on public.user_roles', p.policyname);
  END LOOP;
END $$;

create policy user_roles_select_self_or_admin
on public.user_roles
for select
using (auth.uid() = user_id or public.app_is_admin());

create policy user_roles_insert_admin_only
on public.user_roles
for insert
with check (public.app_is_admin());

create policy user_roles_update_admin_only
on public.user_roles
for update
using (public.app_is_admin())
with check (public.app_is_admin());

create policy user_roles_delete_admin_only
on public.user_roles
for delete
using (public.app_is_admin());

-- 5) Rebuild owner-scoped business policies. Safe to re-run after isolation.
-- NOTE: this intentionally removes existing policies for these tables.
DO $$
DECLARE
  t text;
  p record;
  target_tables text[] := array[
    'regions',
    'labels',
    'places',
    'place_regions',
    'place_labels',
    'trips',
    'itinerary_items'
  ];
  missing_owner_tables text[];
BEGIN
  select coalesce(array_agg(candidate.target_table order by candidate.target_table), '{}'::text[])
  into missing_owner_tables
  from (
    select target_table
    from unnest(target_tables) as candidate(target_table)
    where not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and information_schema.columns.table_name = candidate.target_table
        and column_name = 'owner_uid'
    )
  ) as candidate;

  if array_length(missing_owner_tables, 1) is not null then
    raise notice
      'owner_uid is missing on tables: %. Skip business-table policy rebuild. Run docs/supabase-owner-isolation.sql, then rerun this script.',
      array_to_string(missing_owner_tables, ', ');
    return;
  end if;

  FOREACH t IN ARRAY target_tables LOOP
    FOR p IN
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = t
    LOOP
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    END LOOP;

    execute format('create policy %I on public.%I for all to authenticated using (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin())) with check (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin()))', t || '_owner_or_admin', t);

  END LOOP;
END $$;

-- Ensure RLS is enabled on all business tables with owner_uid present.
DO $$
DECLARE
  t text;
  target_tables text[] := array[
    'regions',
    'labels',
    'places',
    'place_regions',
    'place_labels',
    'trips',
    'itinerary_items'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and information_schema.columns.table_name = t
        and column_name = 'owner_uid'
    ) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  END LOOP;
END $$;

commit;

-- Quick verification snippets:
-- select auth.uid(), public.app_current_role(), public.app_is_member(), public.app_is_admin();
-- select * from public.user_roles where user_id = auth.uid();

-- Phase 1 migration. Run after schema + role bootstrap, as the database owner.
-- Existing unowned regions/places/labels belong to the account confirmed below.
-- Transactional and re-runnable. Existing trip owners and roles are preserved.
-- Before running, set the expected legacy owner email in this SQL session:
--   set local app.legacy_owner_email = 'owner@example.com';
begin;

alter table public.regions add column if not exists owner_uid uuid;
alter table public.places add column if not exists owner_uid uuid;
alter table public.labels add column if not exists owner_uid uuid;

do $$
begin
  if exists(select 1 from public.regions where owner_uid is null) or exists(select 1 from public.places where owner_uid is null) or exists(select 1 from public.labels where owner_uid is null) then
    raise exception 'Baseline requires an empty database or already-owned data. Use the reviewed legacy ownership migration first.';
  end if;
end;
$$;

-- Owner is assigned by the database. Local models/backups do not carry authority.
do $$
declare t text;
begin
  foreach t in array array['regions', 'places', 'labels', 'trips'] loop
    execute format('alter table public.%I alter column owner_uid set default auth.uid()', t);
    execute format('alter table public.%I alter column owner_uid set not null', t);
    execute format('create index if not exists %I on public.%I (owner_uid)', t || '_owner_uid_idx', t);
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_owner_uid_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (owner_uid) references auth.users(id) on delete restrict', t, t || '_owner_uid_fkey');
    end if;
    -- Composite FKs below enforce same-owner relationships, even for admin writes.
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_id_owner_key') then
      execute format('alter table public.%I add constraint %I unique (id, owner_uid)', t, t || '_id_owner_key');
    end if;
  end loop;
end;
$$;

alter table public.itinerary_items add column if not exists owner_uid uuid;
alter table public.place_regions add column if not exists owner_uid uuid;
alter table public.place_labels add column if not exists owner_uid uuid;
update public.itinerary_items i set owner_uid = t.owner_uid from public.trips t where t.id = i.trip_id and i.owner_uid is null;
update public.place_regions r set owner_uid = p.owner_uid from public.places p where p.id = r.place_id and r.owner_uid is null;
update public.place_labels r set owner_uid = p.owner_uid from public.places p where p.id = r.place_id and r.owner_uid is null;

-- Fail without changing data if historical references cross account boundaries.
-- Resolve those references explicitly before retrying; never silently reassign owners.
do $$
begin
  if exists (select 1 from public.trips t join public.regions r on r.id = t.region_id where t.owner_uid <> r.owner_uid)
    or exists (select 1 from public.labels l join public.labels p on p.id = l.parent_id where l.owner_uid <> p.owner_uid)
    or exists (select 1 from public.itinerary_items i join public.trips t on t.id = i.trip_id join public.places p on p.id = i.place_id where i.owner_uid <> t.owner_uid or i.owner_uid <> p.owner_uid)
    or exists (select 1 from public.place_regions x join public.places p on p.id = x.place_id join public.regions r on r.id = x.region_id where x.owner_uid <> p.owner_uid or x.owner_uid <> r.owner_uid)
    or exists (select 1 from public.place_labels x join public.places p on p.id = x.place_id join public.labels l on l.id = x.label_id where x.owner_uid <> p.owner_uid or x.owner_uid <> l.owner_uid)
  then
    raise exception 'Existing references cross owners. Resolve them before migration; no changes applied.';
  end if;
end;
$$;

-- Derived owner columns allow race-safe composite foreign keys. Clients omit them.
create or replace function public.assign_private_record_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare expected_owner uuid;
begin
  if tg_table_name = 'itinerary_items' then
    select owner_uid into expected_owner from public.trips where id = new.trip_id;
  elsif tg_table_name in ('place_regions', 'place_labels') then
    select owner_uid into expected_owner from public.places where id = new.place_id;
  else
    expected_owner := new.owner_uid;
  end if;
  if expected_owner is null then raise exception 'Parent or owner does not exist.'; end if;
  if tg_op = 'UPDATE' and (new.owner_uid is distinct from old.owner_uid or expected_owner is distinct from old.owner_uid) then
    raise exception 'Changing a record owner is not supported.';
  end if;
  new.owner_uid := expected_owner;
  return new;
end;
$$;
revoke all on function public.assign_private_record_owner() from public;

do $$
declare t text;
begin
  foreach t in array array['regions', 'places', 'labels', 'trips', 'itinerary_items', 'place_regions', 'place_labels'] loop
    execute format('alter table public.%I alter column owner_uid set not null', t);
    execute format('drop trigger if exists assign_private_record_owner_tg on public.%I', t);
    execute format('create trigger assign_private_record_owner_tg before insert or update on public.%I for each row execute function public.assign_private_record_owner()', t);
  end loop;
end;
$$;

-- Named constraints make migration re-runnable.
alter table public.trips drop constraint if exists trips_region_owner_fkey;
alter table public.trips add constraint trips_region_owner_fkey foreign key (region_id, owner_uid) references public.regions(id, owner_uid) on delete restrict;
alter table public.labels drop constraint if exists labels_parent_owner_fkey;
alter table public.labels add constraint labels_parent_owner_fkey foreign key (parent_id, owner_uid) references public.labels(id, owner_uid) on delete restrict;
alter table public.itinerary_items drop constraint if exists itinerary_trip_owner_fkey;
alter table public.itinerary_items add constraint itinerary_trip_owner_fkey foreign key (trip_id, owner_uid) references public.trips(id, owner_uid) on delete cascade;
alter table public.itinerary_items drop constraint if exists itinerary_place_owner_fkey;
alter table public.itinerary_items add constraint itinerary_place_owner_fkey foreign key (place_id, owner_uid) references public.places(id, owner_uid) on delete restrict;
alter table public.place_regions drop constraint if exists place_regions_place_owner_fkey;
alter table public.place_regions add constraint place_regions_place_owner_fkey foreign key (place_id, owner_uid) references public.places(id, owner_uid) on delete cascade;
alter table public.place_regions drop constraint if exists place_regions_region_owner_fkey;
alter table public.place_regions add constraint place_regions_region_owner_fkey foreign key (region_id, owner_uid) references public.regions(id, owner_uid) on delete restrict;
alter table public.place_labels drop constraint if exists place_labels_place_owner_fkey;
alter table public.place_labels add constraint place_labels_place_owner_fkey foreign key (place_id, owner_uid) references public.places(id, owner_uid) on delete cascade;
alter table public.place_labels drop constraint if exists place_labels_label_owner_fkey;
alter table public.place_labels add constraint place_labels_label_owner_fkey foreign key (label_id, owner_uid) references public.labels(id, owner_uid) on delete restrict;

-- Phase 1: private trips only. Stored editor lists are preserved for a future migration.
create or replace function public.can_edit_trip(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_is_member() and exists (
    select 1 from public.trips where id = p_trip_id and (owner_uid = auth.uid() or public.app_is_admin())
  );
$$;
create or replace function public.can_manage_trip_acl(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_edit_trip(p_trip_id);
$$;
create or replace function public.prevent_non_owner_acl_changes()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.owner_uid is distinct from old.owner_uid then
    raise exception 'Changing a trip owner is not supported.';
  end if;
  if old.owner_uid is distinct from auth.uid() and not public.app_is_admin() and
    (new.edit_mode is distinct from old.edit_mode or new.editor_uids is distinct from old.editor_uids) then
    raise exception 'Only the trip owner or admin may change ACL fields.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_non_owner_acl_changes_tg on public.trips;
create trigger prevent_non_owner_acl_changes_tg
before update on public.trips
for each row execute function public.prevent_non_owner_acl_changes();

-- Remove ALL prior permissive policies. A separate permissive policy would bypass isolation.
do $$
declare t text; p record;
begin
  foreach t in array array['regions', 'places', 'labels', 'trips', 'itinerary_items', 'place_regions', 'place_labels'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for all to authenticated using (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin())) with check (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin()))', t || '_owner_or_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

commit;

-- Phase 2: safe cloud import/overwrite/clear for current account only
-- Run in Supabase SQL Editor as database owner.
-- Provides preview + token-guarded apply RPCs:
--   public.app_backup_preview_replace(p_backup jsonb)
--   public.app_backup_apply_replace(p_backup jsonb, p_token text)
--   public.app_backup_preview_clear()
--   public.app_backup_apply_clear(p_token text)

begin;

create or replace function public.app_backup_account_counts(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'regions', (select count(*)::int from public.regions where owner_uid = p_uid),
    'places', (select count(*)::int from public.places where owner_uid = p_uid),
    'labels', (select count(*)::int from public.labels where owner_uid = p_uid),
    'trips', (select count(*)::int from public.trips where owner_uid = p_uid),
    'itineraryItems', (select count(*)::int from public.itinerary_items where owner_uid = p_uid)
  )
$$;

create or replace function public.app_backup_account_signature(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(concat_ws('|',
    (select count(*)::text from public.regions where owner_uid = p_uid),
    (select coalesce(max(updated_at)::text, '') from public.regions where owner_uid = p_uid),
    (select count(*)::text from public.places where owner_uid = p_uid),
    (select coalesce(max(updated_at)::text, '') from public.places where owner_uid = p_uid),
    (select count(*)::text from public.labels where owner_uid = p_uid),
    (select coalesce(max(updated_at)::text, '') from public.labels where owner_uid = p_uid),
    (select count(*)::text from public.trips where owner_uid = p_uid),
    (select coalesce(max(updated_at)::text, '') from public.trips where owner_uid = p_uid),
    (select count(*)::text from public.itinerary_items where owner_uid = p_uid),
    (select coalesce(max(updated_at)::text, '') from public.itinerary_items where owner_uid = p_uid),
    (select count(*)::text from public.place_regions where owner_uid = p_uid),
    (select coalesce(
      md5(string_agg(place_id::text || ':' || region_id::text, '|' order by place_id, region_id)),
      ''
    )
    from public.place_regions
    where owner_uid = p_uid),
    (select count(*)::text from public.place_labels where owner_uid = p_uid),
    (select coalesce(
      md5(string_agg(place_id::text || ':' || label_id::text, '|' order by place_id, label_id)),
      ''
    )
    from public.place_labels
    where owner_uid = p_uid)
  ))
$$;

create or replace function public.app_backup_has_shared_trip(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trips t
    where t.owner_uid = p_uid
      and (t.edit_mode <> 'private' or coalesce(array_length(t.editor_uids, 1), 0) > 0)
  )
$$;

create or replace function public.app_backup_assert_payload(p_backup jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  data jsonb;
  entity text;
  forbidden text[] := array['owner_uid', 'ownerUid', 'role', 'roles', 'editor_uids', 'editorUids'];
begin
  if p_backup is null or jsonb_typeof(p_backup) <> 'object' then
    raise exception 'Backup payload must be a JSON object.';
  end if;

  if p_backup->>'format' <> 'travel-planner-backup' or coalesce((p_backup->>'version')::int, 0) <> 1 then
    raise exception 'Unsupported backup format or version.';
  end if;

  data := p_backup->'data';
  if data is null or jsonb_typeof(data) <> 'object' then
    raise exception 'Backup payload data is missing.';
  end if;

  foreach entity in array array['regions','places','labels','trips','itineraryItems'] loop
    if jsonb_typeof(coalesce(data->entity, '[]'::jsonb)) <> 'array' then
      raise exception 'Backup payload data.% must be an array.', entity;
    end if;

    if exists (
      select 1
      from jsonb_array_elements(coalesce(data->entity, '[]'::jsonb)) item
      where item ?| forbidden
    ) then
      raise exception 'Backup payload data.% contains forbidden authorization fields.', entity;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(data->'trips', '[]'::jsonb)) item
    where item ? 'edit_mode' or item ? 'editMode'
  ) then
    raise exception 'Backup payload data.trips cannot specify sharing mode.';
  end if;
end;
$$;

create or replace function public.app_backup_preview_replace(p_backup jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  data jsonb;
  current_counts jsonb;
  incoming_counts jsonb;
  payload_hash text;
  token text;
begin
  if uid is null then
    raise exception '請先登入。';
  end if;

  if not public.app_is_member() then
    raise exception '目前沒有權限執行此操作。';
  end if;

  if public.app_backup_has_shared_trip(uid) then
    raise exception '目前帳號存在已分享或協作中的行程，暫不允許覆蓋雲端資料。';
  end if;

  perform public.app_backup_assert_payload(p_backup);

  data := p_backup->'data';
  current_counts := public.app_backup_account_counts(uid);
  incoming_counts := jsonb_build_object(
    'regions', jsonb_array_length(coalesce(data->'regions', '[]'::jsonb)),
    'places', jsonb_array_length(coalesce(data->'places', '[]'::jsonb)),
    'labels', jsonb_array_length(coalesce(data->'labels', '[]'::jsonb)),
    'trips', jsonb_array_length(coalesce(data->'trips', '[]'::jsonb)),
    'itineraryItems', jsonb_array_length(coalesce(data->'itineraryItems', '[]'::jsonb))
  );

  payload_hash := md5(p_backup::text);
  token := md5(uid::text || '|' || public.app_backup_account_signature(uid) || '|' || payload_hash);

  return jsonb_build_object(
    'token', token,
    'current', current_counts,
    'incoming', incoming_counts
  );
end;
$$;

create or replace function public.app_backup_apply_replace(p_backup jsonb, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  expected_token text;
  data jsonb;
  result jsonb;
begin
  if uid is null then
    raise exception '請先登入。';
  end if;

  if not public.app_is_member() then
    raise exception '目前沒有權限執行此操作。';
  end if;

  if p_token is null or btrim(p_token) = '' then
    raise exception '缺少預覽 token，請先重新預覽。';
  end if;

  if public.app_backup_has_shared_trip(uid) then
    raise exception '目前帳號存在已分享或協作中的行程，暫不允許覆蓋雲端資料。';
  end if;

  perform public.app_backup_assert_payload(p_backup);

  expected_token := md5(uid::text || '|' || public.app_backup_account_signature(uid) || '|' || md5(p_backup::text));
  if expected_token <> p_token then
    raise exception '預覽已過期，雲端資料可能已變更，請重新預覽後再確認。';
  end if;

  data := p_backup->'data';

  create temporary table stg_regions (
    old_id uuid not null,
    new_id uuid not null,
    name text not null,
    center jsonb,
    google_place_id text,
    zoom integer not null
  ) on commit drop;

  insert into stg_regions(old_id, new_id, name, center, google_place_id, zoom)
  select (x.id)::uuid, gen_random_uuid(), x.name, x.center, x."googlePlaceId", x.zoom
  from jsonb_to_recordset(coalesce(data->'regions', '[]'::jsonb)) as x(
    id text,
    name text,
    center jsonb,
    "googlePlaceId" text,
    zoom integer
  );

  create temporary table stg_labels (
    old_id uuid not null,
    new_id uuid not null,
    name text not null,
    color text not null,
    parent_old_id uuid
  ) on commit drop;

  insert into stg_labels(old_id, new_id, name, color, parent_old_id)
  select (x.id)::uuid, gen_random_uuid(), x.name, x.color,
    case when x."parentId" is null or btrim(x."parentId") = '' then null else (x."parentId")::uuid end
  from jsonb_to_recordset(coalesce(data->'labels', '[]'::jsonb)) as x(
    id text,
    name text,
    color text,
    "parentId" text
  );

  if exists (
    select 1
    from stg_labels l
    where l.parent_old_id is not null
      and not exists (select 1 from stg_labels p where p.old_id = l.parent_old_id)
  ) then
    raise exception 'Backup labels include a parentId that does not exist in the same backup.';
  end if;

  create temporary table stg_places (
    old_id uuid not null,
    new_id uuid not null,
    name text not null,
    icon text,
    maps_url text,
    google_place_id text,
    notes text
  ) on commit drop;

  insert into stg_places(old_id, new_id, name, icon, maps_url, google_place_id, notes)
  select (x.id)::uuid, gen_random_uuid(), x.name, x.icon, x."mapsUrl", x."googlePlaceId", x.notes
  from jsonb_to_recordset(coalesce(data->'places', '[]'::jsonb)) as x(
    id text,
    name text,
    icon text,
    "mapsUrl" text,
    "googlePlaceId" text,
    notes text
  );

  create temporary table stg_place_regions (
    place_old_id uuid not null,
    region_old_id uuid not null
  ) on commit drop;

  insert into stg_place_regions(place_old_id, region_old_id)
  select (x.id)::uuid, (rid.value)::uuid
  from jsonb_to_recordset(coalesce(data->'places', '[]'::jsonb)) as x(
    id text,
    "regionIds" jsonb
  )
  cross join lateral jsonb_array_elements_text(coalesce(x."regionIds", '[]'::jsonb)) as rid(value);

  create temporary table stg_place_labels (
    place_old_id uuid not null,
    label_old_id uuid not null
  ) on commit drop;

  insert into stg_place_labels(place_old_id, label_old_id)
  select (x.id)::uuid, (lid.value)::uuid
  from jsonb_to_recordset(coalesce(data->'places', '[]'::jsonb)) as x(
    id text,
    "labelIds" jsonb
  )
  cross join lateral jsonb_array_elements_text(coalesce(x."labelIds", '[]'::jsonb)) as lid(value);

  if exists (
    select 1 from stg_place_regions r
    where not exists (select 1 from stg_places p where p.old_id = r.place_old_id)
      or not exists (select 1 from stg_regions g where g.old_id = r.region_old_id)
  ) then
    raise exception 'Backup places reference a missing region.';
  end if;

  if exists (
    select 1 from stg_place_labels l
    where not exists (select 1 from stg_places p where p.old_id = l.place_old_id)
      or not exists (select 1 from stg_labels g where g.old_id = l.label_old_id)
  ) then
    raise exception 'Backup places reference a missing label.';
  end if;

  create temporary table stg_trips (
    old_id uuid not null,
    new_id uuid not null,
    region_old_id uuid not null,
    name text not null,
    start_date date not null,
    end_date date not null
  ) on commit drop;

  insert into stg_trips(old_id, new_id, region_old_id, name, start_date, end_date)
  select (x.id)::uuid, gen_random_uuid(), (x."regionId")::uuid, x.name, x."startDate"::date, x."endDate"::date
  from jsonb_to_recordset(coalesce(data->'trips', '[]'::jsonb)) as x(
    id text,
    "regionId" text,
    name text,
    "startDate" text,
    "endDate" text
  );

  if exists (
    select 1 from stg_trips t
    where not exists (select 1 from stg_regions g where g.old_id = t.region_old_id)
  ) then
    raise exception 'Backup trips reference a missing region.';
  end if;

  create temporary table stg_items (
    old_id uuid not null,
    new_id uuid not null,
    trip_old_id uuid not null,
    place_old_id uuid not null,
    date date not null,
    arrival_time text,
    duration_minutes integer,
    transport text,
    travel_duration_minutes integer,
    note text,
    sort_order integer not null
  ) on commit drop;

  insert into stg_items(
    old_id,
    new_id,
    trip_old_id,
    place_old_id,
    date,
    arrival_time,
    duration_minutes,
    transport,
    travel_duration_minutes,
    note,
    sort_order
  )
  select
    (x.id)::uuid,
    gen_random_uuid(),
    (x."tripId")::uuid,
    (x."placeId")::uuid,
    x.date::date,
    x."arrivalTime",
    x."durationMinutes",
    x.transport,
    x."travelDurationMinutes",
    x.note,
    x."order"
  from jsonb_to_recordset(coalesce(data->'itineraryItems', '[]'::jsonb)) as x(
    id text,
    "tripId" text,
    "placeId" text,
    date text,
    "arrivalTime" text,
    "durationMinutes" integer,
    transport text,
    "travelDurationMinutes" integer,
    note text,
    "order" integer
  );

  if exists (
    select 1 from stg_items i
    where not exists (select 1 from stg_trips t where t.old_id = i.trip_old_id)
      or not exists (select 1 from stg_places p where p.old_id = i.place_old_id)
  ) then
    raise exception 'Backup itinerary items reference a missing trip or place.';
  end if;

  delete from public.itinerary_items where owner_uid = uid;
  delete from public.place_labels where owner_uid = uid;
  delete from public.place_regions where owner_uid = uid;
  delete from public.trips where owner_uid = uid;
  delete from public.places where owner_uid = uid;
  delete from public.labels where owner_uid = uid;
  delete from public.regions where owner_uid = uid;

  insert into public.regions(id, owner_uid, name, center, google_place_id, zoom)
  select new_id, uid, name, center, google_place_id, zoom
  from stg_regions;

  insert into public.labels(id, owner_uid, name, color, parent_id)
  select l.new_id, uid, l.name, l.color, p.new_id
  from stg_labels l
  left join stg_labels p on p.old_id = l.parent_old_id;

  insert into public.places(id, owner_uid, name, icon, maps_url, google_place_id, notes)
  select new_id, uid, name, icon, maps_url, google_place_id, notes
  from stg_places;

  insert into public.place_regions(place_id, region_id, owner_uid)
  select p.new_id, r.new_id, uid
  from stg_place_regions pr
  join stg_places p on p.old_id = pr.place_old_id
  join stg_regions r on r.old_id = pr.region_old_id;

  insert into public.place_labels(place_id, label_id, owner_uid)
  select p.new_id, l.new_id, uid
  from stg_place_labels pl
  join stg_places p on p.old_id = pl.place_old_id
  join stg_labels l on l.old_id = pl.label_old_id;

  insert into public.trips(id, owner_uid, region_id, name, start_date, end_date, edit_mode, editor_uids)
  select t.new_id, uid, r.new_id, t.name, t.start_date, t.end_date, 'private', '{}'::uuid[]
  from stg_trips t
  join stg_regions r on r.old_id = t.region_old_id;

  insert into public.itinerary_items(
    id,
    owner_uid,
    trip_id,
    place_id,
    date,
    arrival_time,
    duration_minutes,
    transport,
    travel_duration_minutes,
    note,
    sort_order
  )
  select
    i.new_id,
    uid,
    t.new_id,
    p.new_id,
    i.date,
    i.arrival_time,
    i.duration_minutes,
    i.transport,
    i.travel_duration_minutes,
    i.note,
    i.sort_order
  from stg_items i
  join stg_trips t on t.old_id = i.trip_old_id
  join stg_places p on p.old_id = i.place_old_id;

  result := public.app_backup_account_counts(uid);
  return result;
end;
$$;

create or replace function public.app_backup_preview_clear()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current_counts jsonb;
  token text;
begin
  if uid is null then
    raise exception '請先登入。';
  end if;

  if not public.app_is_member() then
    raise exception '目前沒有權限執行此操作。';
  end if;

  if public.app_backup_has_shared_trip(uid) then
    raise exception '目前帳號存在已分享或協作中的行程，暫不允許整批清空。';
  end if;

  current_counts := public.app_backup_account_counts(uid);
  token := md5(uid::text || '|' || public.app_backup_account_signature(uid) || '|clear');

  return jsonb_build_object(
    'token', token,
    'current', current_counts,
    'incoming', jsonb_build_object('regions', 0, 'places', 0, 'labels', 0, 'trips', 0, 'itineraryItems', 0)
  );
end;
$$;

create or replace function public.app_backup_apply_clear(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  expected_token text;
  current_counts jsonb;
begin
  if uid is null then
    raise exception '請先登入。';
  end if;

  if not public.app_is_member() then
    raise exception '目前沒有權限執行此操作。';
  end if;

  if p_token is null or btrim(p_token) = '' then
    raise exception '缺少預覽 token，請先重新預覽。';
  end if;

  if public.app_backup_has_shared_trip(uid) then
    raise exception '目前帳號存在已分享或協作中的行程，暫不允許整批清空。';
  end if;

  expected_token := md5(uid::text || '|' || public.app_backup_account_signature(uid) || '|clear');
  if expected_token <> p_token then
    raise exception '預覽已過期，雲端資料可能已變更，請重新預覽後再確認。';
  end if;

  current_counts := public.app_backup_account_counts(uid);

  delete from public.itinerary_items where owner_uid = uid;
  delete from public.place_labels where owner_uid = uid;
  delete from public.place_regions where owner_uid = uid;
  delete from public.trips where owner_uid = uid;
  delete from public.places where owner_uid = uid;
  delete from public.labels where owner_uid = uid;
  delete from public.regions where owner_uid = uid;

  return current_counts;
end;
$$;

revoke all on function public.app_backup_account_counts(uuid) from public;
grant execute on function public.app_backup_account_counts(uuid) to authenticated;

revoke all on function public.app_backup_account_signature(uuid) from public;
grant execute on function public.app_backup_account_signature(uuid) to authenticated;

revoke all on function public.app_backup_has_shared_trip(uuid) from public;
grant execute on function public.app_backup_has_shared_trip(uuid) to authenticated;

revoke all on function public.app_backup_assert_payload(jsonb) from public;
grant execute on function public.app_backup_assert_payload(jsonb) to authenticated;

revoke all on function public.app_backup_preview_replace(jsonb) from public;
grant execute on function public.app_backup_preview_replace(jsonb) to authenticated;

revoke all on function public.app_backup_apply_replace(jsonb, text) from public;
grant execute on function public.app_backup_apply_replace(jsonb, text) to authenticated;

revoke all on function public.app_backup_preview_clear() from public;
grant execute on function public.app_backup_preview_clear() to authenticated;

revoke all on function public.app_backup_apply_clear(text) from public;
grant execute on function public.app_backup_apply_clear(text) to authenticated;

commit;
