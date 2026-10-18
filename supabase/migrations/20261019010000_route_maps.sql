-- Add route-map persistence without replaying the baseline or distance migrations.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create table public.route_maps (
  id uuid primary key default gen_random_uuid(),
  owner_uid uuid not null default auth.uid() references auth.users(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  trip_id uuid,
  selected_date date,
  origin_google_place_id text,
  destination_google_place_id text,
  transport text not null check (transport in ('DRIVING', 'WALKING', 'BICYCLING', 'TRANSIT', 'TWO_WHEELER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_maps_id_owner_key unique (id, owner_uid),
  constraint route_maps_trip_owner_fkey
    foreign key (trip_id, owner_uid) references public.trips(id, owner_uid) on delete cascade,
  constraint route_maps_origin_google_place_id_check
    check (origin_google_place_id is null or btrim(origin_google_place_id) <> ''),
  constraint route_maps_destination_google_place_id_check
    check (destination_google_place_id is null or btrim(destination_google_place_id) <> ''),
  constraint route_maps_endpoints_distinct_check
    check (origin_google_place_id is null or destination_google_place_id is null or origin_google_place_id <> destination_google_place_id)
);

create unique index route_maps_trip_id_unique_idx
  on public.route_maps (trip_id)
  where trip_id is not null;
create index route_maps_owner_uid_idx on public.route_maps (owner_uid);

create table public.route_map_places (
  id uuid primary key default gen_random_uuid(),
  owner_uid uuid not null default auth.uid() references auth.users(id) on delete restrict,
  route_map_id uuid not null,
  google_place_id text not null check (btrim(google_place_id) <> ''),
  name text check (name is null or btrim(name) <> ''),
  created_at timestamptz not null default now(),
  constraint route_map_places_id_owner_key unique (id, owner_uid),
  constraint route_map_places_route_map_owner_fkey
    foreign key (route_map_id, owner_uid) references public.route_maps(id, owner_uid) on delete cascade,
  constraint route_map_places_map_google_place_unique unique (route_map_id, google_place_id)
);

create index route_map_places_owner_uid_idx on public.route_map_places (owner_uid);
create index route_map_places_route_map_id_idx on public.route_map_places (route_map_id);

create function public.assign_route_map_record_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare expected_owner uuid;
begin
  if tg_table_name = 'route_maps' then
    if new.trip_id is not null then
      select owner_uid into expected_owner from public.trips where id = new.trip_id;
    else
      expected_owner := new.owner_uid;
    end if;
  elsif tg_table_name = 'route_map_places' then
    select owner_uid into expected_owner from public.route_maps where id = new.route_map_id;
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
revoke all on function public.assign_route_map_record_owner() from public;

create trigger assign_private_record_owner_tg
before insert or update on public.route_maps
for each row execute function public.assign_route_map_record_owner();
create trigger assign_private_record_owner_tg
before insert or update on public.route_map_places
for each row execute function public.assign_route_map_record_owner();
create trigger set_updated_at_route_maps
before update on public.route_maps
for each row execute function public.set_updated_at();

alter table public.route_maps enable row level security;
alter table public.route_map_places enable row level security;
revoke all on public.route_maps from anon;
revoke all on public.route_map_places from anon;
grant select, insert, update, delete on public.route_maps to authenticated;
grant select, insert, update, delete on public.route_map_places to authenticated;

create policy route_maps_owner_or_admin
  on public.route_maps for all to authenticated
  using (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin()))
  with check (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin()));
create policy route_map_places_owner_or_admin
  on public.route_map_places for all to authenticated
  using (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin()))
  with check (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin()));

create or replace function sync_private.record(p_entity text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  case p_entity
  when 'regions' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'center',center,'googlePlaceId',google_place_id,'zoom',zoom))
    into result from public.regions where id=p_id;
  when 'labels' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'color',color,'parentId',parent_id))
    into result from public.labels where id=p_id;
  when 'places' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'icon',icon,'mapsUrl',maps_url,'googlePlaceId',google_place_id,'notes',notes,
      'regionIds',coalesce((select jsonb_agg(region_id order by region_id) from public.place_regions where place_id=p_id),'[]'::jsonb),
      'labelIds',coalesce((select jsonb_agg(label_id order by label_id) from public.place_labels where place_id=p_id),'[]'::jsonb)))
    into result from public.places where id=p_id;
  when 'trips' then
    select jsonb_build_object('id',id,'name',name,'regionId',region_id,'startDate',start_date,'endDate',end_date)
    into result from public.trips where id=p_id;
  when 'itineraryItems' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'tripId',trip_id,'placeId',place_id,'date',date,'order',sort_order,
      'arrivalTime',arrival_time,'durationMinutes',duration_minutes,'transport',transport,'travelDurationMinutes',travel_duration_minutes,
      'travelDistanceMeters',travel_distance_meters,'note',note))
    into result from public.itinerary_items where id=p_id;
  when 'routeMaps' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'tripId',trip_id,'selectedDate',selected_date,
      'originGooglePlaceId',origin_google_place_id,'destinationGooglePlaceId',destination_google_place_id,'transport',transport))
    into result from public.route_maps where id=p_id;
  when 'routeMapPlaces' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'routeMapId',route_map_id,'googlePlaceId',google_place_id,'name',name))
    into result from public.route_map_places where id=p_id;
  else raise exception 'Unsupported entity';
  end case;
  return result;
end;
$$;

create or replace function sync_private.track()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source jsonb;
  entity_name text := tg_table_name;
  record_id uuid;
  owner_id uuid;
  revision uuid := gen_random_uuid();
begin
  source := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  owner_id := (source->>'owner_uid')::uuid;
  if tg_table_name in ('place_regions','place_labels') then
    entity_name := 'places';
    record_id := (source->>'place_id')::uuid;
  else
    record_id := (source->>'id')::uuid;
    if entity_name='itinerary_items' then entity_name:='itineraryItems'; end if;
    if entity_name='route_maps' then entity_name:='routeMaps'; end if;
    if entity_name='route_map_places' then entity_name:='routeMapPlaces'; end if;
  end if;
  insert into sync_private.versions(entity,id,owner_uid,version) values(entity_name,record_id,owner_id,revision)
  on conflict(entity,id) do update set version=excluded.version;
  insert into sync_private.events(owner_uid,transaction_id,entity,id,version,record)
  values(owner_id,pg_current_xact_id()::text,entity_name,record_id,revision,sync_private.record(entity_name,record_id));
  return null;
end;
$$;

do $$
begin
  create trigger sync_lock_statement before insert or update or delete on public.route_maps
    for each statement execute function sync_private.lock_writes();
  create trigger sync_track_row after insert or update or delete on public.route_maps
    for each row execute function sync_private.track();
  create trigger sync_lock_statement before insert or update or delete on public.route_map_places
    for each statement execute function sync_private.lock_writes();
  create trigger sync_track_row after insert or update or delete on public.route_map_places
    for each row execute function sync_private.track();
end;
$$;

create or replace function public.app_sync_snapshot()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare user_id uuid := sync_private.authorize(); result jsonb;
begin
  perform pg_advisory_xact_lock(741293,1);
  select jsonb_build_object('protocolVersion',1,'cursor',coalesce((select max(sequence)::text from sync_private.events),'0'),
    'records',coalesce(jsonb_agg(
      jsonb_build_object('entity',entity,'id',id,'version',version,'record',sync_private.record(entity,id))
      order by case entity
        when 'regions' then 1
        when 'labels' then 2
        when 'places' then 3
        when 'trips' then 4
        when 'routeMaps' then 5
        when 'routeMapPlaces' then 6
        when 'itineraryItems' then 7
        else 8
      end, entity, id
    ),'[]'::jsonb))
  into result from sync_private.versions where owner_uid=user_id and sync_private.record(entity,id) is not null;
  return result;
end;
$$;

create or replace function public.app_sync_push(p_task jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  user_id uuid := sync_private.authorize();
  task_operation_id uuid;
  existing sync_private.receipts%rowtype;
  change jsonb;
  body jsonb;
  entity_name text;
  table_name text;
  record_id uuid;
  current_version sync_private.versions%rowtype;
  allowed text[];
  conflicts jsonb := '[]'::jsonb;
  result jsonb;
  initial_sequence bigint;
  parent_id uuid;
begin
  if p_task is null or jsonb_typeof(p_task) is distinct from 'object' or p_task->>'protocolVersion' is distinct from '1'
    or jsonb_typeof(p_task->'changes') is distinct from 'array' then
    raise exception 'Invalid sync task';
  end if;
  if jsonb_array_length(p_task->'changes') not between 1 and 500 or octet_length(p_task::text)>1048576 then raise exception 'Task exceeds limits'; end if;
  if (p_task->'account'->>'userId') is distinct from user_id::text then raise exception 'Account mismatch' using errcode='42501'; end if;
  task_operation_id := (p_task->>'operationId')::uuid;
  if task_operation_id is null then raise exception 'Missing operation ID'; end if;
  perform pg_advisory_xact_lock(741293,1);
  select * into existing from sync_private.receipts where owner_uid=user_id and operation_id=task_operation_id;
  if found then
    if existing.payload<>p_task then raise exception 'Operation ID reused with a different payload'; end if;
    return existing.result;
  end if;
  if exists(select 1 from jsonb_array_elements(p_task->'changes') item group by item->>'entity',item->>'id' having count(*)>1) then
    raise exception 'Duplicate entity in task';
  end if;
  for change in select value from jsonb_array_elements(p_task->'changes') loop
    entity_name:=change->>'entity'; record_id:=(change->>'id')::uuid;
    if entity_name is null or entity_name not in ('regions','places','labels','trips','itineraryItems','routeMaps','routeMapPlaces') or record_id is null
      or change->>'kind' is null or change->>'kind' not in ('put','delete') then raise exception 'Invalid change'; end if;
    select * into current_version from sync_private.versions where entity=entity_name and id=record_id;
    if found and current_version.owner_uid<>user_id then raise exception 'Record belongs to another account' using errcode='42501'; end if;
    if not (change ? 'baseVersion') or
      (change->>'baseVersion') is distinct from current_version.version::text then
      conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',entity_name,'id',record_id,'version',current_version.version,
        'record',sync_private.record(entity_name,record_id)));
    end if;
    current_version:=null;
  end loop;
  if jsonb_array_length(conflicts)>0 then return jsonb_build_object('status','conflict','conflicts',conflicts); end if;
  select coalesce(max(sequence),0) into initial_sequence from sync_private.events;
  set constraints public.itinerary_items_trip_id_date_sort_order_key deferred;
  for change in select value from jsonb_array_elements(p_task->'changes') loop
    entity_name:=change->>'entity'; record_id:=(change->>'id')::uuid;
    table_name:=case entity_name
      when 'itineraryItems' then 'itinerary_items'
      when 'routeMaps' then 'route_maps'
      when 'routeMapPlaces' then 'route_map_places'
      else entity_name end;
    if change->>'kind'='delete' then
      execute format('delete from public.%I where id=$1 and owner_uid=$2',table_name) using record_id,user_id;
      continue;
    end if;
    body:=change->'after';
    allowed:=case entity_name
      when 'regions' then array['id','name','center','googlePlaceId','zoom']
      when 'labels' then array['id','name','color','parentId']
      when 'places' then array['id','name','icon','mapsUrl','googlePlaceId','notes','regionIds','labelIds']
      when 'trips' then array['id','name','regionId','startDate','endDate']
      when 'itineraryItems' then array['id','tripId','placeId','date','order','arrivalTime','durationMinutes','transport','travelDurationMinutes','travelDistanceMeters','note']
      when 'routeMaps' then array['id','name','tripId','selectedDate','originGooglePlaceId','destinationGooglePlaceId','transport']
      else array['id','routeMapId','googlePlaceId','name'] end;
    if body is null or jsonb_typeof(body)<>'object' or body->>'id' is distinct from record_id::text
      or exists(select 1 from jsonb_object_keys(body) key where not(key=any(allowed))) then raise exception 'Invalid record or authorization fields'; end if;
    case entity_name
    when 'regions' then
      insert into public.regions(id,owner_uid,name,center,google_place_id,zoom)
      values(record_id,user_id,body->>'name',body->'center',body->>'googlePlaceId',(body->>'zoom')::int)
      on conflict(id) do update set name=excluded.name,center=excluded.center,google_place_id=excluded.google_place_id,zoom=excluded.zoom;
    when 'labels' then
      insert into public.labels(id,owner_uid,name,color,parent_id)
      values(record_id,user_id,body->>'name',body->>'color',(body->>'parentId')::uuid)
      on conflict(id) do update set name=excluded.name,color=excluded.color,parent_id=excluded.parent_id;
    when 'places' then
      if jsonb_typeof(body->'regionIds') is distinct from 'array' or jsonb_typeof(body->'labelIds') is distinct from 'array' then raise exception 'Missing place relations'; end if;
      insert into public.places(id,owner_uid,name,icon,maps_url,google_place_id,notes)
      values(record_id,user_id,body->>'name',body->>'icon',body->>'mapsUrl',body->>'googlePlaceId',body->>'notes')
      on conflict(id) do update set name=excluded.name,icon=excluded.icon,maps_url=excluded.maps_url,google_place_id=excluded.google_place_id,notes=excluded.notes;
      delete from public.place_regions where place_id=record_id;
      delete from public.place_labels where place_id=record_id;
      for parent_id in select value::uuid from jsonb_array_elements_text(body->'regionIds') loop
        insert into public.place_regions(place_id,region_id,owner_uid) values(record_id,parent_id,user_id);
      end loop;
      for parent_id in select value::uuid from jsonb_array_elements_text(body->'labelIds') loop
        insert into public.place_labels(place_id,label_id,owner_uid) values(record_id,parent_id,user_id);
      end loop;
    when 'trips' then
      insert into public.trips(id,owner_uid,name,region_id,start_date,end_date)
      values(record_id,user_id,body->>'name',(body->>'regionId')::uuid,(body->>'startDate')::date,(body->>'endDate')::date)
      on conflict(id) do update set name=excluded.name,region_id=excluded.region_id,start_date=excluded.start_date,end_date=excluded.end_date;
    when 'itineraryItems' then
      insert into public.itinerary_items(id,owner_uid,trip_id,place_id,date,sort_order,arrival_time,duration_minutes,transport,travel_duration_minutes,travel_distance_meters,note)
      values(record_id,user_id,(body->>'tripId')::uuid,(body->>'placeId')::uuid,(body->>'date')::date,(body->>'order')::int,
        body->>'arrivalTime',(body->>'durationMinutes')::int,body->>'transport',(body->>'travelDurationMinutes')::int,(body->>'travelDistanceMeters')::bigint,body->>'note')
      on conflict(id) do update set trip_id=excluded.trip_id,place_id=excluded.place_id,date=excluded.date,sort_order=excluded.sort_order,
        arrival_time=excluded.arrival_time,duration_minutes=excluded.duration_minutes,transport=excluded.transport,
        travel_duration_minutes=excluded.travel_duration_minutes,travel_distance_meters=excluded.travel_distance_meters,note=excluded.note;
    when 'routeMaps' then
      insert into public.route_maps(id,owner_uid,name,trip_id,selected_date,origin_google_place_id,destination_google_place_id,transport)
      values(record_id,user_id,body->>'name',(body->>'tripId')::uuid,(body->>'selectedDate')::date,
        body->>'originGooglePlaceId',body->>'destinationGooglePlaceId',body->>'transport')
      on conflict(id) do update set name=excluded.name,trip_id=excluded.trip_id,selected_date=excluded.selected_date,
        origin_google_place_id=excluded.origin_google_place_id,destination_google_place_id=excluded.destination_google_place_id,transport=excluded.transport;
    when 'routeMapPlaces' then
      insert into public.route_map_places(id,owner_uid,route_map_id,google_place_id,name)
      values(record_id,user_id,(body->>'routeMapId')::uuid,body->>'googlePlaceId',body->>'name')
      on conflict(id) do update set route_map_id=excluded.route_map_id,google_place_id=excluded.google_place_id,name=excluded.name;
    end case;
  end loop;
  set constraints all immediate;
  select jsonb_build_object('status','applied','operationId',task_operation_id,'cursor',coalesce(max(sequence),initial_sequence)::text,
    'changes',coalesce(jsonb_agg(jsonb_build_object('entity',entity,'id',id,'version',version,'record',record,'sequence',sequence::text,'transactionId',transaction_id) order by sequence),'[]'::jsonb))
  into result from sync_private.events where owner_uid=user_id and sequence>initial_sequence;
  insert into sync_private.receipts(owner_uid,operation_id,payload,result) values(user_id,task_operation_id,p_task,result);
  return result;
end;
$$;

create or replace function public.app_backup_account_counts(p_uid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'regions', (select count(*)::int from public.regions where owner_uid = p_uid),
    'places', (select count(*)::int from public.places where owner_uid = p_uid),
    'labels', (select count(*)::int from public.labels where owner_uid = p_uid),
    'trips', (select count(*)::int from public.trips where owner_uid = p_uid),
    'itineraryItems', (select count(*)::int from public.itinerary_items where owner_uid = p_uid),
    'routeMaps', (select count(*)::int from public.route_maps where owner_uid = p_uid),
    'routeMapPlaces', (select count(*)::int from public.route_map_places where owner_uid = p_uid)
  )
$$;

create or replace function public.app_backup_account_signature(p_uid uuid)
returns text language sql stable security definer set search_path = '' as $$
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
    (select coalesce(md5(string_agg(place_id::text || ':' || region_id::text, '|' order by place_id, region_id)), '')
      from public.place_regions where owner_uid = p_uid),
    (select count(*)::text from public.place_labels where owner_uid = p_uid),
    (select coalesce(md5(string_agg(place_id::text || ':' || label_id::text, '|' order by place_id, label_id)), '')
      from public.place_labels where owner_uid = p_uid),
    (select count(*)::text from public.route_maps where owner_uid = p_uid),
    (select coalesce(md5(jsonb_agg(
      jsonb_build_array(id,name,trip_id,selected_date,origin_google_place_id,destination_google_place_id,transport)
      order by id
    )::text), '') from public.route_maps where owner_uid = p_uid),
    (select count(*)::text from public.route_map_places where owner_uid = p_uid),
    (select coalesce(md5(jsonb_agg(jsonb_build_array(id,route_map_id,google_place_id,name) order by id)::text), '')
      from public.route_map_places where owner_uid = p_uid)
  ))
$$;

create or replace function public.app_backup_assert_payload(p_backup jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  data jsonb;
  entity text;
  item jsonb;
  backup_version integer;
  forbidden text[] := array['owner_uid', 'ownerUid', 'role', 'roles', 'editor_uids', 'editorUids'];
begin
  if p_backup is null or jsonb_typeof(p_backup) <> 'object' then
    raise exception 'Backup payload must be a JSON object.';
  end if;
  backup_version := coalesce((p_backup->>'version')::int, 0);
  if p_backup->>'format' <> 'travel-planner-backup' or backup_version not in (1, 2) then
    raise exception 'Unsupported backup format or version.';
  end if;
  data := p_backup->'data';
  if data is null or jsonb_typeof(data) <> 'object' then
    raise exception 'Backup payload data is missing.';
  end if;
  if exists (
    select 1 from jsonb_object_keys(data) key
    where key not in ('regions','places','labels','trips','itineraryItems','routeMaps','routeMapPlaces')
  ) then
    raise exception 'Backup payload data contains an unsupported entity.';
  end if;
  if backup_version = 1 and (data ? 'routeMaps' or data ? 'routeMapPlaces') then
    raise exception 'Version 1 backup cannot contain route-map fields.';
  end if;
  foreach entity in array array['regions','places','labels','trips','itineraryItems'] loop
    if jsonb_typeof(coalesce(data->entity, '[]'::jsonb)) <> 'array' then
      raise exception 'Backup payload data.% must be an array.', entity;
    end if;
  end loop;
  if backup_version = 2 then
    foreach entity in array array['routeMaps','routeMapPlaces'] loop
      if jsonb_typeof(data->entity) is distinct from 'array' then
        raise exception 'Version 2 backup payload data.% must be an array.', entity;
      end if;
    end loop;
  end if;
  foreach entity in array array['regions','places','labels','trips','itineraryItems','routeMaps','routeMapPlaces'] loop
    for item in select value from jsonb_array_elements(coalesce(data->entity, '[]'::jsonb)) loop
      if jsonb_typeof(item) is distinct from 'object' then
        raise exception 'Backup payload data.% entries must be objects.', entity;
      end if;
      if item ?| forbidden then
        raise exception 'Backup payload data.% contains forbidden authorization fields.', entity;
      end if;
      if entity = 'routeMaps' and exists (
        select 1 from jsonb_object_keys(item) key
        where key not in ('id','name','tripId','selectedDate','originGooglePlaceId','destinationGooglePlaceId','transport')
      ) then raise exception 'Backup route map contains unsupported fields.'; end if;
      if entity = 'routeMaps' and (
        not (item ?& array['id','name','transport'])
        or jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(item->'name') is distinct from 'string'
        or btrim(item->>'name') = ''
        or jsonb_typeof(item->'transport') is distinct from 'string'
        or item->>'transport' not in ('DRIVING','WALKING','BICYCLING','TRANSIT','TWO_WHEELER')
        or (item ? 'tripId' and item->'tripId' <> 'null'::jsonb
          and (jsonb_typeof(item->'tripId') is distinct from 'string'
            or item->>'tripId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
        or (item ? 'selectedDate' and item->'selectedDate' <> 'null'::jsonb
          and (jsonb_typeof(item->'selectedDate') is distinct from 'string' or item->>'selectedDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
        or (item ? 'originGooglePlaceId' and item->'originGooglePlaceId' <> 'null'::jsonb
          and (jsonb_typeof(item->'originGooglePlaceId') is distinct from 'string' or btrim(item->>'originGooglePlaceId') = ''))
        or (item ? 'destinationGooglePlaceId' and item->'destinationGooglePlaceId' <> 'null'::jsonb
          and (jsonb_typeof(item->'destinationGooglePlaceId') is distinct from 'string' or btrim(item->>'destinationGooglePlaceId') = ''))
        or (item->>'originGooglePlaceId' is not null and item->>'destinationGooglePlaceId' is not null
          and item->>'originGooglePlaceId' = item->>'destinationGooglePlaceId')
      ) then raise exception 'Backup route map has invalid or missing fields.'; end if;
      if entity = 'routeMapPlaces' and exists (
        select 1 from jsonb_object_keys(item) key
        where key not in ('id','routeMapId','googlePlaceId','name')
      ) then raise exception 'Backup route-map place contains unsupported fields.'; end if;
      if entity = 'routeMapPlaces' and (
        not (item ?& array['id','routeMapId','googlePlaceId'])
        or jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(item->'routeMapId') is distinct from 'string'
        or item->>'routeMapId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(item->'googlePlaceId') is distinct from 'string'
        or btrim(item->>'googlePlaceId') = ''
        or (item ? 'name' and item->'name' <> 'null'::jsonb
          and (jsonb_typeof(item->'name') is distinct from 'string' or btrim(item->>'name') = ''))
      ) then raise exception 'Backup route-map place has invalid or missing fields.'; end if;
    end loop;
  end loop;
  if exists (
    select route_map_entry->>'id'
    from jsonb_array_elements(coalesce(data->'routeMaps','[]'::jsonb)) route_map_entry
    group by route_map_entry->>'id' having count(*) > 1
  ) then raise exception 'Backup contains duplicate route-map IDs.'; end if;
  if exists (
    select route_map_entry->>'tripId'
    from jsonb_array_elements(coalesce(data->'routeMaps','[]'::jsonb)) route_map_entry
    where route_map_entry->>'tripId' is not null and route_map_entry->>'tripId' <> ''
    group by route_map_entry->>'tripId' having count(*) > 1
  ) then raise exception 'Backup contains multiple route maps for one trip.'; end if;
  if exists (
    select route_map_place_entry->>'id'
    from jsonb_array_elements(coalesce(data->'routeMapPlaces','[]'::jsonb)) route_map_place_entry
    group by route_map_place_entry->>'id' having count(*) > 1
  ) then raise exception 'Backup contains duplicate route-map-place IDs.'; end if;
  if exists (
    select route_map_place_entry->>'routeMapId', route_map_place_entry->>'googlePlaceId'
    from jsonb_array_elements(coalesce(data->'routeMapPlaces','[]'::jsonb)) route_map_place_entry
    group by route_map_place_entry->>'routeMapId', route_map_place_entry->>'googlePlaceId' having count(*) > 1
  ) then raise exception 'Backup contains duplicate Google places in a route map.'; end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(data->'routeMaps','[]'::jsonb)) map
    where map->>'tripId' is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(data->'trips','[]'::jsonb)) trip
      where trip->>'id' = map->>'tripId'
    )
  ) then raise exception 'Backup route maps reference a missing trip.'; end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(data->'routeMapPlaces','[]'::jsonb)) place
    where not exists (
      select 1 from jsonb_array_elements(coalesce(data->'routeMaps','[]'::jsonb)) map
      where map->>'id' = place->>'routeMapId'
    )
  ) then raise exception 'Backup route-map places reference a missing route map.'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(data->'trips', '[]'::jsonb)) trip_entry
    where trip_entry ? 'edit_mode' or trip_entry ? 'editMode'
  ) then raise exception 'Backup payload data.trips cannot specify sharing mode.'; end if;
end;
$$;

create or replace function public.app_backup_preview_replace(p_backup jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  data jsonb;
  current_counts jsonb;
  incoming_counts jsonb;
  payload_hash text;
  token text;
begin
  if uid is null then raise exception '請先登入。'; end if;
  if not public.app_is_member() then raise exception '目前沒有權限執行此操作。'; end if;
  if public.app_backup_has_shared_trip(uid) then raise exception '目前帳號存在已分享或協作中的行程，暫不允許覆蓋雲端資料。'; end if;
  perform public.app_backup_assert_payload(p_backup);
  if p_backup->>'version' = '1' and exists (select 1 from public.route_maps where owner_uid=uid) then
    raise exception 'Version 1 backup cannot replace an account with route maps; use a version 2 backup.';
  end if;
  data := p_backup->'data';
  current_counts := public.app_backup_account_counts(uid);
  incoming_counts := jsonb_build_object(
    'regions', jsonb_array_length(coalesce(data->'regions', '[]'::jsonb)),
    'places', jsonb_array_length(coalesce(data->'places', '[]'::jsonb)),
    'labels', jsonb_array_length(coalesce(data->'labels', '[]'::jsonb)),
    'trips', jsonb_array_length(coalesce(data->'trips', '[]'::jsonb)),
    'itineraryItems', jsonb_array_length(coalesce(data->'itineraryItems', '[]'::jsonb)),
    'routeMaps', jsonb_array_length(coalesce(data->'routeMaps', '[]'::jsonb)),
    'routeMapPlaces', jsonb_array_length(coalesce(data->'routeMapPlaces', '[]'::jsonb))
  );
  payload_hash := md5(p_backup::text);
  token := md5(uid::text || '|' || public.app_backup_account_signature(uid) || '|' || payload_hash);
  return jsonb_build_object('token', token, 'current', current_counts, 'incoming', incoming_counts);
end;
$$;

-- Extend the reviewed replacement function in-place, retaining its itinerary-distance support.
do $migration$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_get_functiondef('public.app_backup_apply_replace(jsonb,text)'::regprocedure);

  old_fragment := '  create temporary table stg_items (';
  new_fragment := $insert$
  create temporary table stg_route_maps (
    old_id uuid primary key,
    new_id uuid not null unique,
    trip_old_id uuid,
    name text not null,
    selected_date date,
    origin_google_place_id text,
    destination_google_place_id text,
    transport text not null
  ) on commit drop;

  insert into stg_route_maps(old_id,new_id,trip_old_id,name,selected_date,origin_google_place_id,destination_google_place_id,transport)
  select (x.id)::uuid,gen_random_uuid(),nullif(btrim(x."tripId"),'')::uuid,x.name,x."selectedDate"::date,
    x."originGooglePlaceId",x."destinationGooglePlaceId",x.transport
  from jsonb_to_recordset(coalesce(data->'routeMaps','[]'::jsonb)) as x(
    id text,name text,"tripId" text,"selectedDate" text,"originGooglePlaceId" text,"destinationGooglePlaceId" text,transport text
  );

  if exists (
    select 1 from stg_route_maps m
    where m.trip_old_id is not null and not exists (select 1 from stg_trips t where t.old_id=m.trip_old_id)
  ) then raise exception 'Backup route maps reference a missing trip.'; end if;

  create temporary table stg_route_map_places (
    old_id uuid primary key,
    new_id uuid not null unique,
    route_map_old_id uuid not null,
    google_place_id text not null,
    name text
  ) on commit drop;

  insert into stg_route_map_places(old_id,new_id,route_map_old_id,google_place_id,name)
  select (x.id)::uuid,gen_random_uuid(),(x."routeMapId")::uuid,x."googlePlaceId",x.name
  from jsonb_to_recordset(coalesce(data->'routeMapPlaces','[]'::jsonb)) as x(
    id text,"routeMapId" text,"googlePlaceId" text,name text
  );

  if exists (
    select 1 from stg_route_map_places p
    where not exists (select 1 from stg_route_maps m where m.old_id=p.route_map_old_id)
  ) then raise exception 'Backup route-map places reference a missing route map.'; end if;

  create temporary table stg_items ($insert$;
  if position(old_fragment in definition)=0 then
    raise exception 'Expected backup itinerary staging block was not found; refusing partial migration.';
  end if;
  definition := replace(definition,old_fragment,new_fragment);

  old_fragment := '  perform public.app_backup_assert_payload(p_backup);';
  new_fragment := old_fragment || chr(10) ||
    '  if p_backup->>''version'' = ''1'' and exists (select 1 from public.route_maps where owner_uid=uid) then' || chr(10) ||
    '    raise exception ''Version 1 backup cannot replace an account with route maps; use a version 2 backup.'';' || chr(10) ||
    '  end if;';
  if position(old_fragment in definition)=0 then
    raise exception 'Expected backup payload validation was not found; refusing partial migration.';
  end if;
  definition := replace(definition,old_fragment,new_fragment);

  old_fragment := '  delete from public.trips where owner_uid = uid;';
  new_fragment := '  delete from public.route_maps where owner_uid = uid;' || chr(10) || old_fragment;
  if position(old_fragment in definition)=0 then
    raise exception 'Expected backup trip deletion block was not found; refusing partial migration.';
  end if;
  definition := replace(definition,old_fragment,new_fragment);

  old_fragment := '  insert into public.itinerary_items(';
  new_fragment := $insert$
  insert into public.route_maps(id,owner_uid,name,trip_id,selected_date,origin_google_place_id,destination_google_place_id,transport)
  select m.new_id,uid,m.name,t.new_id,m.selected_date,m.origin_google_place_id,m.destination_google_place_id,m.transport
  from stg_route_maps m
  left join stg_trips t on t.old_id=m.trip_old_id;

  insert into public.route_map_places(id,owner_uid,route_map_id,google_place_id,name)
  select p.new_id,uid,m.new_id,p.google_place_id,p.name
  from stg_route_map_places p
  join stg_route_maps m on m.old_id=p.route_map_old_id;

  insert into public.itinerary_items($insert$;
  if position(old_fragment in definition)=0 then
    raise exception 'Expected backup itinerary insertion block was not found; refusing partial migration.';
  end if;
  definition := replace(definition,old_fragment,new_fragment);
  execute definition;
end;
$migration$;

create or replace function public.app_backup_preview_clear()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_counts jsonb;
  token text;
begin
  if uid is null then raise exception '請先登入。'; end if;
  if not public.app_is_member() then raise exception '目前沒有權限執行此操作。'; end if;
  if public.app_backup_has_shared_trip(uid) then raise exception '目前帳號存在已分享或協作中的行程，暫不允許整批清空。'; end if;
  current_counts := public.app_backup_account_counts(uid);
  token := md5(uid::text || '|' || public.app_backup_account_signature(uid) || '|clear');
  return jsonb_build_object(
    'token',token,
    'current',current_counts,
    'incoming',jsonb_build_object('regions',0,'places',0,'labels',0,'trips',0,'itineraryItems',0,'routeMaps',0,'routeMapPlaces',0)
  );
end;
$$;

create or replace function public.app_backup_apply_clear(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  expected_token text;
  current_counts jsonb;
begin
  if uid is null then raise exception '請先登入。'; end if;
  if not public.app_is_member() then raise exception '目前沒有權限執行此操作。'; end if;
  if p_token is null or btrim(p_token) = '' then raise exception '缺少預覽 token，請先重新預覽。'; end if;
  if public.app_backup_has_shared_trip(uid) then raise exception '目前帳號存在已分享或協作中的行程，暫不允許整批清空。'; end if;
  expected_token := md5(uid::text || '|' || public.app_backup_account_signature(uid) || '|clear');
  if expected_token <> p_token then raise exception '預覽已過期，雲端資料可能已變更，請重新預覽後再確認。'; end if;
  current_counts := public.app_backup_account_counts(uid);
  delete from public.itinerary_items where owner_uid = uid;
  delete from public.place_labels where owner_uid = uid;
  delete from public.place_regions where owner_uid = uid;
  delete from public.trips where owner_uid = uid;
  delete from public.route_maps where owner_uid = uid;
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
revoke all on function public.app_backup_assert_payload(jsonb) from public;
grant execute on function public.app_backup_assert_payload(jsonb) to authenticated;
revoke all on function public.app_backup_preview_replace(jsonb) from public;
grant execute on function public.app_backup_preview_replace(jsonb) to authenticated;
revoke all on function public.app_backup_apply_replace(jsonb,text) from public;
grant execute on function public.app_backup_apply_replace(jsonb,text) to authenticated;
revoke all on function public.app_backup_preview_clear() from public;
grant execute on function public.app_backup_preview_clear() to authenticated;
revoke all on function public.app_backup_apply_clear(text) from public;
grant execute on function public.app_backup_apply_clear(text) to authenticated;

notify pgrst, 'reload schema';
commit;
