begin;

alter table public.itinerary_items drop constraint itinerary_items_trip_id_date_sort_order_key;
alter table public.itinerary_items add constraint itinerary_items_trip_id_date_sort_order_key unique(trip_id,date,sort_order) deferrable initially immediate;

create schema if not exists sync_private;
revoke all on schema sync_private from public, anon, authenticated;

create table sync_private.events (
  sequence bigint generated always as identity primary key,
  owner_uid uuid not null,
  transaction_id text not null,
  entity text not null,
  id uuid not null,
  version uuid not null,
  record jsonb,
  created_at timestamptz not null default now()
);
create index sync_events_owner_sequence on sync_private.events(owner_uid, sequence);
create table sync_private.versions (
  entity text not null,
  id uuid not null,
  owner_uid uuid not null,
  version uuid not null,
  primary key(entity, id)
);
create table sync_private.receipts (
  owner_uid uuid not null,
  operation_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  primary key(owner_uid, operation_id)
);
alter table sync_private.events enable row level security;
alter table sync_private.versions enable row level security;
alter table sync_private.receipts enable row level security;

create function sync_private.lock_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(741293, 1);
  return null;
end;
$$;

create function sync_private.record(p_entity text, p_id uuid)
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
      'arrivalTime',arrival_time,'durationMinutes',duration_minutes,'transport',transport,'travelDurationMinutes',travel_duration_minutes,'note',note))
    into result from public.itinerary_items where id=p_id;
  else raise exception 'Unsupported entity';
  end case;
  return result;
end;
$$;

create function sync_private.track()
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
  end if;
  insert into sync_private.versions(entity,id,owner_uid,version) values(entity_name,record_id,owner_id,revision)
  on conflict(entity,id) do update set version=excluded.version;
  insert into sync_private.events(owner_uid,transaction_id,entity,id,version,record)
  values(owner_id,pg_current_xact_id()::text,entity_name,record_id,revision,sync_private.record(entity_name,record_id));
  return null;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['regions','labels','places','trips','itinerary_items','place_regions','place_labels'] loop
    execute format('create trigger sync_lock_statement before insert or update or delete on public.%I for each statement execute function sync_private.lock_writes()',table_name);
    execute format('create trigger sync_track_row after insert or update or delete on public.%I for each row execute function sync_private.track()',table_name);
  end loop;
end;
$$;

create function sync_private.authorize()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.app_is_member() then
    raise exception 'Sync requires member or admin access' using errcode='42501';
  end if;
  return auth.uid();
end;
$$;

create function public.app_sync_snapshot()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare user_id uuid := sync_private.authorize(); result jsonb;
begin
  perform pg_advisory_xact_lock(741293,1);
  select jsonb_build_object('protocolVersion',1,'cursor',coalesce((select max(sequence)::text from sync_private.events),'0'),
    'records',coalesce(jsonb_agg(jsonb_build_object('entity',entity,'id',id,'version',version,'record',sync_private.record(entity,id)) order by entity,id),'[]'::jsonb))
  into result from sync_private.versions where owner_uid=user_id and sync_private.record(entity,id) is not null;
  return result;
end;
$$;

create function public.app_sync_pull(p_cursor text, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  user_id uuid := sync_private.authorize();
  cursor_value bigint;
  watermark bigint;
  page_end bigint;
  last_transaction text;
  result jsonb;
begin
  if p_cursor is null or p_cursor !~ '^[0-9]+$' or p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid cursor or limit'; end if;
  cursor_value := p_cursor::bigint;
  perform pg_advisory_xact_lock(741293,1);
  select coalesce(max(sequence),0) into watermark from sync_private.events;
  if cursor_value>watermark then raise exception 'Cursor is ahead of server; reinitialize'; end if;
  select max(sequence) into page_end from (
    select sequence from sync_private.events where owner_uid=user_id and sequence>cursor_value order by sequence limit p_limit
  ) page;
  if page_end is not null then
    select transaction_id into last_transaction from sync_private.events where sequence=page_end;
    select max(sequence) into page_end from sync_private.events where transaction_id=last_transaction;
  else page_end:=watermark;
  end if;
  select jsonb_build_object('protocolVersion',1,'cursor',page_end::text,'hasMore',page_end<watermark,
    'changes',coalesce(jsonb_agg(jsonb_build_object('entity',entity,'id',id,'version',version,'record',record,'transactionId',transaction_id,'sequence',sequence::text) order by sequence),'[]'::jsonb))
  into result from sync_private.events where owner_uid=user_id and sequence>cursor_value and sequence<=page_end;
  return result;
end;
$$;

create function public.app_sync_push(p_task jsonb)
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
      else array['id','tripId','placeId','date','order','arrivalTime','durationMinutes','transport','travelDurationMinutes','note'] end;
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
      insert into public.itinerary_items(id,owner_uid,trip_id,place_id,date,sort_order,arrival_time,duration_minutes,transport,travel_duration_minutes,note)
      values(record_id,user_id,(body->>'tripId')::uuid,(body->>'placeId')::uuid,(body->>'date')::date,(body->>'order')::int,
        body->>'arrivalTime',(body->>'durationMinutes')::int,body->>'transport',(body->>'travelDurationMinutes')::int,body->>'note')
      on conflict(id) do update set trip_id=excluded.trip_id,place_id=excluded.place_id,date=excluded.date,sort_order=excluded.sort_order,
        arrival_time=excluded.arrival_time,duration_minutes=excluded.duration_minutes,transport=excluded.transport,
        travel_duration_minutes=excluded.travel_duration_minutes,note=excluded.note;
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

do $$
declare entity_name text; table_name text; row_data record;
begin
  perform pg_advisory_xact_lock(741293,1);
  foreach entity_name in array array['regions','labels','places','trips','itineraryItems'] loop
    table_name:=case when entity_name='itineraryItems' then 'itinerary_items' else entity_name end;
    for row_data in execute format('select id,owner_uid from public.%I',table_name) loop
      insert into sync_private.versions(entity,id,owner_uid,version) values(entity_name,row_data.id,row_data.owner_uid,gen_random_uuid());
    end loop;
  end loop;
end;
$$;

revoke all on all functions in schema sync_private from public,anon,authenticated;
revoke all on function public.app_sync_snapshot() from public,anon;
revoke all on function public.app_sync_pull(text,integer) from public,anon;
revoke all on function public.app_sync_push(jsonb) from public,anon;
grant execute on function public.app_sync_snapshot() to authenticated;
grant execute on function public.app_sync_pull(text,integer) to authenticated;
grant execute on function public.app_sync_push(jsonb) to authenticated;

commit;
