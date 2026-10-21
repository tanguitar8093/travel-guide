-- Independent public snapshots; source UUIDs deliberately have no personal-table FK.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
create schema public_itinerary_private;
revoke all on schema public_itinerary_private from public, anon, authenticated;
create table public.public_itineraries (
  id uuid primary key,
  owner_uid uuid not null references auth.users(id) on delete restrict,
  source_trip_id uuid not null,
  snapshot jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz,
  version uuid not null default gen_random_uuid(),
  sequence bigint generated always as identity not null unique,
  withdrawn boolean not null default false,
  constraint public_snapshot_state check (withdrawn = (snapshot is null))
);
create unique index public_itineraries_source on public.public_itineraries(owner_uid, source_trip_id) where not withdrawn;
alter table public.public_itineraries enable row level security;
revoke all on public.public_itineraries from public, anon, authenticated;
grant select on public.public_itineraries to anon, authenticated;
create policy public_itineraries_read on public.public_itineraries for select to anon, authenticated using (not withdrawn);
create table public_itinerary_private.receipts (
  owner_uid uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  primary key(owner_uid, operation_id)
);
alter table public_itinerary_private.receipts enable row level security;
revoke all on public_itinerary_private.receipts from public, anon, authenticated;

-- Reject extra fields rather than accepting private place notes, labels or authorization fields.
create function public_itinerary_private.validate_snapshot(s jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare node jsonb; keys text[];
begin
  if s is null or jsonb_typeof(s) <> 'object' or s->>'schemaVersion' is distinct from '1'
    or octet_length(s::text) > 1048576
    or jsonb_typeof(s->'region') is distinct from 'object'
    or jsonb_typeof(s->'trip') is distinct from 'object'
    or jsonb_typeof(s->'places') is distinct from 'array'
    or jsonb_typeof(s->'items') is distinct from 'array'
    or exists(select 1 from jsonb_object_keys(s) k where k not in ('schemaVersion','region','trip','places','items'))
    then raise exception 'Invalid public snapshot' using errcode='22023'; end if;
  if s->'region' ? 'center' then
    node := s->'region'->'center';
    if jsonb_typeof(node) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(node) k where k not in ('latitude','longitude'))
      or jsonb_typeof(node->'latitude') is distinct from 'number' or jsonb_typeof(node->'longitude') is distinct from 'number'
      or (node->>'latitude')::numeric not between -90 and 90 or (node->>'longitude')::numeric not between -180 and 180 then
      raise exception 'Invalid public coordinates' using errcode='22023'; end if;
  end if;
  if jsonb_array_length(s->'places') > 500 or jsonb_array_length(s->'items') > 500 then
    raise exception 'Public snapshot exceeds 500 places or items' using errcode='22023'; end if;
  for node, keys in
    select s->'region', array['id','name','center','googlePlaceId','zoom']
    union all select s->'trip', array['id','regionId','name','startDate','endDate']
    union all select value, array['id','name','icon','mapsUrl','googlePlaceId','regionIds'] from jsonb_array_elements(s->'places')
    union all select value, array['id','tripId','placeId','date','arrivalTime','durationMinutes','transport','travelDurationMinutes','travelDistanceMeters','note','order'] from jsonb_array_elements(s->'items')
  loop
    if jsonb_typeof(node) <> 'object' or node->>'id' is null
      or exists(select 1 from jsonb_object_keys(node) k where not k=any(keys)) then
      raise exception 'Invalid public fields' using errcode='22023'; end if;
    perform (node->>'id')::uuid;
  end loop;
  if nullif(btrim(s->'region'->>'name'),'') is null or nullif(btrim(s->'trip'->>'name'),'') is null
    or jsonb_typeof(s->'region'->'zoom') is distinct from 'number'
    or (nullif(btrim(s->'region'->>'googlePlaceId'),'') is null and s->'region'->'center' is null)
    or (s->'region'->>'zoom')::numeric <> trunc((s->'region'->>'zoom')::numeric)
    or (s->'region'->>'zoom')::numeric not between 0 and 22
    or (s->'trip'->>'regionId') is distinct from (s->'region'->>'id')
    or s->'trip'->>'startDate' is null or s->'trip'->>'endDate' is null
    or (s->'trip'->>'startDate')::date > (s->'trip'->>'endDate')::date then
    raise exception 'Invalid public region or trip' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(s->'places') p
    where nullif(btrim(p->>'name'),'') is null
      or (nullif(btrim(p->>'googlePlaceId'),'') is null and nullif(btrim(p->>'mapsUrl'),'') is null)
      or (p ? 'mapsUrl' and (p->>'mapsUrl') !~* '^https?://') or p->'regionIds' is distinct from jsonb_build_array(s->'region'->>'id'))
    or exists(select 1 from jsonb_array_elements(s->'places') p group by p->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(s->'items') i group by i->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(s->'items') i group by i->>'date',i->>'order' having count(*)>1)
    then raise exception 'Invalid public places or duplicate items' using errcode='22023'; end if;
  for node in select value from jsonb_array_elements(s->'items') loop
    if node->>'tripId' is distinct from s->'trip'->>'id'
      or not exists(select 1 from jsonb_array_elements(s->'places') p where p->>'id'=node->>'placeId')
      or node->>'date' is null
      or (node->>'date')::date not between (s->'trip'->>'startDate')::date and (s->'trip'->>'endDate')::date
      or jsonb_typeof(node->'order') is distinct from 'number' or (node->>'order')::numeric < 0
      or (node->>'order')::numeric <> trunc((node->>'order')::numeric) then
      raise exception 'Invalid public itinerary item' using errcode='22023'; end if;
  end loop;
end;
$$;
create function public_itinerary_private.document(r public.public_itineraries) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',r.id,'ownerId',r.owner_uid,'sourceTripId',r.source_trip_id,
    'sourceWorkspaceId','','createdAt',r.created_at,'updatedAt',r.updated_at,'snapshot',r.snapshot,
    'version',r.version,'sequence',r.sequence::text,'withdrawn',r.withdrawn);
$$;

-- Serialized sequence allocation/pull prevents advancing a cursor past an uncommitted write.
-- Only this explicitly authorized helper can write; clients have no direct table DML.
create function public_itinerary_private.api(action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
<<api_block>>
declare
  uid uuid := auth.uid(); r public.public_itineraries; receipt public_itinerary_private.receipts;
  rid uuid; op uuid; result jsonb; rows jsonb; last_sequence bigint; cursor_value bigint; page_size int;
  source_row public.trips; region_id uuid; trip_id uuid; label_id uuid; place_id uuid;
  node jsonb; item jsonb; place_map jsonb := '{}'::jsonb; copy_name text; suffix int := 1;
  colors text[] := array['#e9905a','#d97768','#c4809b','#8b80b5','#758dab','#6c9a79','#b77a53','#5f9b9b'];
begin
  perform pg_catalog.pg_advisory_xact_lock(741293,1);
  perform pg_catalog.pg_advisory_xact_lock(741293,2);
  if action='pull' then
    cursor_value := coalesce((payload->>'cursor')::bigint,0);
    page_size := least(greatest(coalesce((payload->>'limit')::int,100),1),100);
    if cursor_value < 0 then raise exception 'Invalid cursor' using errcode='22023'; end if;
    select coalesce(jsonb_agg(public_itinerary_private.document(t) order by t.sequence),'[]'::jsonb),coalesce(max(t.sequence),cursor_value)
      into rows,last_sequence from (select * from public.public_itineraries where sequence>cursor_value order by sequence limit page_size) t;
    return jsonb_build_object('records',rows,'cursor',last_sequence::text,
      'hasMore',exists(select 1 from public.public_itineraries where sequence>last_sequence));
  end if;
  if uid is null or not public.app_is_member() then raise exception 'Publishing requires member access' using errcode='42501'; end if;
  if action='source' then
    select * into source_row from public.trips where id=(payload->>'sourceTripId')::uuid and owner_uid=uid;
    if not found then raise exception 'Source trip missing or belongs to another account' using errcode='42501'; end if;
    result := jsonb_build_object('schemaVersion',1,'region',sync_private.record('regions',source_row.region_id),
      'trip',sync_private.record('trips',source_row.id),
      'places',coalesce((select jsonb_agg((sync_private.record('places',p.id)-'notes'-'labelIds') || jsonb_build_object('regionIds',jsonb_build_array(source_row.region_id)))
        from public.places p where p.id in (select i.place_id from public.itinerary_items i where i.trip_id=source_row.id)),'[]'::jsonb),
      'items',coalesce((select jsonb_agg(sync_private.record('itineraryItems',i.id) order by i.date,i.sort_order) from public.itinerary_items i where i.trip_id=source_row.id),'[]'::jsonb));
    return result;
  end if;
  if action='apply' then
    op := (payload->>'operationId')::uuid;
    if op is null then raise exception 'Missing apply operation' using errcode='22023'; end if;
    select * into receipt from public_itinerary_private.receipts where owner_uid=uid and operation_id=op;
    if found then
      if receipt.payload is distinct from jsonb_build_object('action',action,'payload',payload) then raise exception 'Operation ID reused' using errcode='22023'; end if;
      return receipt.result;
    end if;
    select * into r from public.public_itineraries where id=(payload->>'id')::uuid and not withdrawn;
    if not found then raise exception 'Public itinerary withdrawn or missing' using errcode='P0002'; end if;
    region_id := gen_random_uuid(); trip_id := gen_random_uuid(); label_id := gen_random_uuid();
    node := r.snapshot->'region';
    insert into public.regions(id,owner_uid,name,center,google_place_id,zoom)
      values(region_id,uid,(node->>'name')||'(分享)',node->'center',node->>'googlePlaceId',(node->>'zoom')::int);
    insert into public.labels(id,owner_uid,name,color)
      values(label_id,uid,(r.snapshot->'trip'->>'name')||'(分享)',colors[1+floor(random()*array_length(colors,1))::int]);
    loop
      copy_name := (r.snapshot->'trip'->>'name')||'（副本'||case when suffix=1 then '' else ' '||suffix::text end||'）';
      exit when not exists(select 1 from public.trips where owner_uid=uid and name=copy_name);
      suffix := suffix+1;
    end loop;
    insert into public.trips(id,owner_uid,region_id,name,start_date,end_date)
      values(trip_id,uid,region_id,copy_name,(r.snapshot->'trip'->>'startDate')::date,(r.snapshot->'trip'->>'endDate')::date);
    for node in select value from jsonb_array_elements(r.snapshot->'places') loop
      place_id := gen_random_uuid(); place_map := place_map || jsonb_build_object(node->>'id',place_id);
      insert into public.places(id,owner_uid,name,icon,maps_url,google_place_id)
        values(place_id,uid,node->>'name',node->>'icon',node->>'mapsUrl',node->>'googlePlaceId');
      insert into public.place_regions(place_id,region_id,owner_uid) values(api_block.place_id,api_block.region_id,uid);
      insert into public.place_labels(place_id,label_id,owner_uid) values(api_block.place_id,api_block.label_id,uid);
    end loop;
    for item in select value from jsonb_array_elements(r.snapshot->'items') loop
      insert into public.itinerary_items(id,owner_uid,trip_id,place_id,date,sort_order,arrival_time,duration_minutes,transport,travel_duration_minutes,travel_distance_meters,note)
        values(gen_random_uuid(),uid,trip_id,(place_map->>(item->>'placeId'))::uuid,(item->>'date')::date,(item->>'order')::int,
        (item->>'arrivalTime')::time,(item->>'durationMinutes')::int,item->>'transport',(item->>'travelDurationMinutes')::int,(item->>'travelDistanceMeters')::bigint,item->>'note');
    end loop;
    result := sync_private.record('trips',trip_id);
    insert into public_itinerary_private.receipts values(uid,op,jsonb_build_object('action',action,'payload',payload),result);
    return result;
  end if;
  if action not in ('publish','update','withdraw') then raise exception 'Invalid action' using errcode='22023'; end if;
  rid := (payload->>'id')::uuid; op := (payload->>'operationId')::uuid;
  if rid is null or op is null or payload->>'sourceTripId' is null or not payload ? 'baseVersion' then
    raise exception 'Missing operation, source or base version' using errcode='22023'; end if;
  select * into receipt from public_itinerary_private.receipts where owner_uid=uid and operation_id=op;
  if found then
    if receipt.payload is distinct from jsonb_build_object('action',action,'payload',payload) then raise exception 'Operation ID reused' using errcode='22023'; end if;
    return receipt.result;
  end if;
  select * into r from public.public_itineraries where id=rid;
  if found and (r.owner_uid<>uid or r.source_trip_id<>(payload->>'sourceTripId')::uuid) then
    raise exception 'Only the publisher can manage this snapshot' using errcode='42501'; end if;
  if action='publish' then
    if r.id is not null or payload->>'baseVersion' is not null then
      return jsonb_build_object('status','conflict','record',case when r.id is null then null else public_itinerary_private.document(r) end);
    end if;
    select * into r from public.public_itineraries where owner_uid=uid and source_trip_id=(payload->>'sourceTripId')::uuid and not withdrawn;
    if found then return jsonb_build_object('status','conflict','record',public_itinerary_private.document(r)); end if;
  elsif r.id is null or r.version::text is distinct from payload->>'baseVersion' or r.withdrawn then
    return jsonb_build_object('status','conflict','record',case when r.id is null then null else public_itinerary_private.document(r) end);
  end if;
  if action<>'withdraw' then perform public_itinerary_private.validate_snapshot(payload->'snapshot'); end if;
  if action='publish' then
    insert into public.public_itineraries(id,owner_uid,source_trip_id,snapshot)
      values(rid,uid,(payload->>'sourceTripId')::uuid,payload->'snapshot') returning * into r;
  else
    update public.public_itineraries set snapshot=case when action='withdraw' then null else payload->'snapshot' end,
      withdrawn=action='withdraw',version=gen_random_uuid(),sequence=default,updated_at=clock_timestamp()
      where id=rid returning * into r;
  end if;
  result := jsonb_build_object('status','applied','operationId',op,'record',public_itinerary_private.document(r));
  insert into public_itinerary_private.receipts values(uid,op,jsonb_build_object('action',action,'payload',payload),result);
  return result;
end;
$$;
revoke all on all functions in schema public_itinerary_private from public, anon, authenticated;
grant usage on schema public_itinerary_private to anon, authenticated;
grant execute on function public_itinerary_private.api(text,jsonb) to anon, authenticated;
-- Exposed invoker wrapper has no privileges of its own. Private helper explicitly authorizes writes.
create function public.app_public_itinerary(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select public_itinerary_private.api(p_action,p_payload);
$$;
revoke all on function public.app_public_itinerary(text,jsonb) from public, anon, authenticated;
grant execute on function public.app_public_itinerary(text,jsonb) to anon, authenticated;
notify pgrst,'reload schema';
commit;
