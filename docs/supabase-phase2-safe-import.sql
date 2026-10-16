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
