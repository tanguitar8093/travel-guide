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
