-- Add a nullable distance without modifying existing estimates or replaying the baseline.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

alter table public.itinerary_items
  add column travel_distance_meters bigint
  constraint itinerary_items_travel_distance_meters_check
  check (travel_distance_meters between 0 and 9007199254740991);

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
      'arrivalTime',arrival_time,'durationMinutes',duration_minutes,'transport',transport,'travelDurationMinutes',travel_duration_minutes,'travelDistanceMeters',travel_distance_meters,'note',note))
    into result from public.itinerary_items where id=p_id;
  else raise exception 'Unsupported entity';
  end case;
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
    if entity_name is null or entity_name not in ('regions','places','labels','trips','itineraryItems') or record_id is null
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
    table_name:=case when entity_name='itineraryItems' then 'itinerary_items' else entity_name end;
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
      else array['id','tripId','placeId','date','order','arrivalTime','durationMinutes','transport','travelDurationMinutes','travelDistanceMeters','note'] end;
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
    else
      insert into public.itinerary_items(id,owner_uid,trip_id,place_id,date,sort_order,arrival_time,duration_minutes,transport,travel_duration_minutes,travel_distance_meters,note)
      values(record_id,user_id,(body->>'tripId')::uuid,(body->>'placeId')::uuid,(body->>'date')::date,(body->>'order')::int,
        body->>'arrivalTime',(body->>'durationMinutes')::int,body->>'transport',(body->>'travelDurationMinutes')::int,(body->>'travelDistanceMeters')::bigint,body->>'note')
      on conflict(id) do update set trip_id=excluded.trip_id,place_id=excluded.place_id,date=excluded.date,sort_order=excluded.sort_order,
        arrival_time=excluded.arrival_time,duration_minutes=excluded.duration_minutes,transport=excluded.transport,
        travel_duration_minutes=excluded.travel_duration_minutes,travel_distance_meters=excluded.travel_distance_meters,note=excluded.note;
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

-- Some deployments use the existing row-update fallback instead of this RPC.
do $migration$
begin
  if to_regprocedure('public.app_reorder_itinerary_items(uuid,date,uuid[])') is not null then
    execute $definition$
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
      end,
      travel_distance_meters = case
        when previous_before.previous_place_id is distinct from previous_after.previous_place_id then null
        else items.travel_distance_meters
      end
  from ordered
  join previous_before on previous_before.id = ordered.id
  join previous_after on previous_after.id = ordered.id
  where items.id = ordered.id;
end;
$$;
$definition$;
  end if;
end;
$migration$;

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
    travel_distance_meters bigint,
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
    travel_distance_meters,
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
    x."travelDistanceMeters",
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
    "travelDistanceMeters" bigint,
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
    travel_distance_meters,
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
    i.travel_distance_meters,
    i.note,
    i.sort_order
  from stg_items i
  join stg_trips t on t.old_id = i.trip_old_id
  join stg_places p on p.old_id = i.place_old_id;

  result := public.app_backup_account_counts(uid);
  return result;
end;
$$;

notify pgrst, 'reload schema';
commit;
