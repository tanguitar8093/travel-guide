-- Phase 1 migration. Run after schema + role bootstrap, as the database owner.
-- Existing unowned regions/places/labels belong to the account confirmed below.
-- Transactional and re-runnable. Existing trip owners and roles are preserved.
begin;

alter table public.regions add column if not exists owner_uid uuid;
alter table public.places add column if not exists owner_uid uuid;
alter table public.labels add column if not exists owner_uid uuid;

do $$
declare
  legacy_owner uuid;
  t text;
begin
  select id into legacy_owner from auth.users
  where lower(email) = 'tanguitar8093@gmail.com';
  if legacy_owner is null then
    raise exception 'Legacy owner account tanguitar8093@gmail.com was not found; no changes applied.';
  end if;
  foreach t in array array['regions', 'places', 'labels'] loop
    execute format('update public.%I set owner_uid = $1 where owner_uid is null', t) using legacy_owner;
  end loop;
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
