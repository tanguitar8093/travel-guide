begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Additive geo contract on the existing outbox/RPC protocol. Apply this migration
-- before deploying the client; never replay the baseline against a live project.
alter table public.regions add column map_provider text, add column center_metadata jsonb,
  alter column zoom type numeric using zoom::numeric;
alter table public.places add column location jsonb;
alter table public.route_maps add column origin jsonb, add column destination jsonb;
alter table public.route_map_places add column location jsonb, alter column google_place_id drop not null;

create function sync_private.validate_location(value jsonb, with_coordinate boolean default true)
returns void language plpgsql immutable set search_path = '' as $$
declare allowed text[];
begin
  if jsonb_typeof(value) is distinct from 'object'
    or value->>'source' is null or value->>'source' not in ('user','legacy-user','osm')
    or value->>'kind' is null or value->>'kind' not in ('point','approximate-center','map-center','user-picked') then
    raise exception 'Invalid stored location source or kind' using errcode='22023';
  end if;
  allowed := array['source','kind'];
  if value->>'source'='osm' then
    allowed := allowed || array['reference','datasetVersion'];
    if jsonb_typeof(value->'reference') is distinct from 'object'
      or value->'reference'->>'provider' is distinct from 'osm'
      or coalesce(value->'reference'->>'id','') !~ '^(node|way|relation)/[1-9][0-9]*$'
      or exists(select 1 from jsonb_object_keys(value->'reference') k where k not in ('provider','id'))
      or (value ? 'datasetVersion' and (jsonb_typeof(value->'datasetVersion') is distinct from 'string'
        or btrim(value->>'datasetVersion')='')) then
      raise exception 'Invalid OSM reference' using errcode='22023';
    end if;
  end if;
  if with_coordinate then
    allowed := allowed || array['coordinate'];
    if jsonb_typeof(value->'coordinate') is distinct from 'object'
      or jsonb_typeof(value->'coordinate'->'latitude') is distinct from 'number'
      or jsonb_typeof(value->'coordinate'->'longitude') is distinct from 'number'
      or (value->'coordinate'->>'latitude')::numeric not between -90 and 90
      or (value->'coordinate'->>'longitude')::numeric not between -180 and 180
      or exists(select 1 from jsonb_object_keys(value->'coordinate') k where k not in ('latitude','longitude')) then
      raise exception 'Invalid stored coordinates' using errcode='22023';
    end if;
  end if;
  if exists(select 1 from jsonb_object_keys(value) k where not k=any(allowed)) then
    raise exception 'Unsupported stored location fields' using errcode='22023';
  end if;
end;
$$;

create function sync_private.validate_region_geo(body jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if body ? 'mapProvider' and (body->>'mapProvider' is null or body->>'mapProvider' not in ('google','osm')) then
    raise exception 'Invalid map provider' using errcode='22023';
  end if;
  if body ? 'centerMetadata' then
    perform sync_private.validate_location(body->'centerMetadata',false);
    if not body ? 'center' then raise exception 'Region metadata requires a center'; end if;
    perform sync_private.validate_location((body->'centerMetadata')||jsonb_build_object('coordinate',body->'center'));
  end if;
  if body->>'mapProvider'='osm' then
    if body ? 'googlePlaceId' or not body ?& array['center','centerMetadata']
      or jsonb_typeof(body->'center'->'latitude') is distinct from 'number'
      or jsonb_typeof(body->'center'->'longitude') is distinct from 'number'
      or (body->'center'->>'latitude')::numeric not between 25.98 and 26.9
      or (body->'center'->>'longitude')::numeric not between 127.58 and 128.36 then
      raise exception 'OSM region requires an attributed center inside Okinawa' using errcode='22023';
    end if;
  end if;
end;
$$;

create function sync_private.validate_place_geo(body jsonb, provider text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if body ? 'location' then
    perform sync_private.validate_location(body->'location');
    if body ? 'googlePlaceId' or provider is distinct from 'osm'
      or (body->'location'->'coordinate'->>'latitude')::numeric not between 25.98 and 26.9
      or (body->'location'->'coordinate'->>'longitude')::numeric not between 127.58 and 128.36 then
      raise exception 'Stored places require an OSM region inside Okinawa' using errcode='22023';
    end if;
  elsif provider='osm' then
    raise exception 'OSM places require stored coordinates' using errcode='22023';
  end if;
end;
$$;

create function sync_private.endpoint_key(endpoint jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare allowed text[]; v jsonb;
begin
  if endpoint is null then return null; end if;
  if jsonb_typeof(endpoint) is distinct from 'object' then raise exception 'Invalid route endpoint'; end if;
  case endpoint->>'kind'
  when 'place' then
    allowed:=array['kind','placeId'];
    if nullif(endpoint->>'placeId','') is null then raise exception 'Missing endpoint place'; end if;
    perform (endpoint->>'placeId')::uuid;
  when 'shared-place' then
    allowed:=array['kind','tripId','placeId'];
    if nullif(endpoint->>'tripId','') is null or nullif(endpoint->>'placeId','') is null then raise exception 'Missing shared endpoint'; end if;
    perform (endpoint->>'tripId')::uuid,(endpoint->>'placeId')::uuid;
  when 'route-map-place' then
    allowed:=array['kind','routeMapPlaceId'];
    if nullif(endpoint->>'routeMapPlaceId','') is null then raise exception 'Missing endpoint marker'; end if;
    perform (endpoint->>'routeMapPlaceId')::uuid;
  when 'location' then
    allowed:=array['kind','id','value'];
    if jsonb_typeof(endpoint->'id') is distinct from 'string' or btrim(endpoint->>'id')='' then raise exception 'Missing endpoint identity'; end if;
    v:=endpoint->'value';
    if jsonb_typeof(v) is distinct from 'object' then raise exception 'Invalid endpoint value'; end if;
    if v->>'kind'='stored' then
      if jsonb_typeof(v->'name') is distinct from 'string' or btrim(v->>'name')=''
        or exists(select 1 from jsonb_object_keys(v) k where k not in ('kind','name','location')) then
        raise exception 'Invalid stored endpoint';
      end if;
      perform sync_private.validate_location(v->'location');
    elsif v->>'kind'='google' then
      if jsonb_typeof(v->'reference') is distinct from 'object'
        or v->'reference'->>'provider' is distinct from 'google'
        or jsonb_typeof(v->'reference'->'id') is distinct from 'string' or btrim(v->'reference'->>'id')=''
        or exists(select 1 from jsonb_object_keys(v->'reference') k where k not in ('provider','id'))
        or exists(select 1 from jsonb_object_keys(v) k where k not in ('kind','name','reference'))
        or (v ? 'name' and (jsonb_typeof(v->'name') is distinct from 'string' or btrim(v->>'name')='')) then
        raise exception 'Invalid Google endpoint';
      end if;
    else raise exception 'Invalid endpoint value kind';
    end if;
  else raise exception 'Invalid route endpoint kind';
  end case;
  if exists(select 1 from jsonb_object_keys(endpoint) k where not k=any(allowed)) then raise exception 'Unsupported endpoint fields'; end if;
  return case endpoint->>'kind'
    when 'place' then jsonb_build_array('place',endpoint->>'placeId')::text
    when 'shared-place' then jsonb_build_array('shared-place',endpoint->>'tripId',endpoint->>'placeId')::text
    when 'route-map-place' then jsonb_build_array('route-map-place',endpoint->>'routeMapPlaceId')::text
    else case when v->>'kind'='google' then jsonb_build_array('google',v->'reference'->>'id')::text
      when v->'location'->>'source'='osm' then jsonb_build_array('osm',v->'location'->'reference'->>'id')::text
      else jsonb_build_array('location',endpoint->>'id')::text end end;
end;
$$;

create function sync_private.validate_map_geo(body jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare side text; endpoint jsonb; legacy text; origin_key text; destination_key text; key_value text;
begin
  foreach side in array array['origin','destination'] loop
    endpoint:=body->side;
    legacy:=body->>(side||'GooglePlaceId');
    key_value:=sync_private.endpoint_key(endpoint);
    if endpoint is not null and legacy is not null and (
      endpoint->>'kind' is distinct from 'location' or endpoint->'value'->>'kind' is distinct from 'google'
      or endpoint->'value'->'reference'->>'id' is distinct from legacy) then
      raise exception 'Legacy and structured route endpoints disagree';
    end if;
    key_value:=coalesce(key_value,case when legacy is not null then jsonb_build_array('google',legacy)::text end);
    if side='origin' then origin_key:=key_value; else destination_key:=key_value; end if;
  end loop;
  if origin_key=destination_key then raise exception 'Route endpoints must differ'; end if;
end;
$$;

create function sync_private.geo_row_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='regions' then
    perform sync_private.validate_region_geo(jsonb_strip_nulls(jsonb_build_object(
      'mapProvider',new.map_provider,'centerMetadata',new.center_metadata,'center',new.center,'googlePlaceId',new.google_place_id)));
  elsif tg_table_name='places' then
    if new.location is not null then perform sync_private.validate_location(new.location); end if;
    if new.location is not null and new.google_place_id is not null then raise exception 'A place cannot mix Google and stored locations'; end if;
  elsif tg_table_name='route_maps' then
    perform sync_private.validate_map_geo(jsonb_strip_nulls(jsonb_build_object(
      'origin',new.origin,'destination',new.destination,'originGooglePlaceId',new.origin_google_place_id,
      'destinationGooglePlaceId',new.destination_google_place_id)));
  else
    if new.location is not null then
      perform sync_private.validate_location(new.location);
      if new.name is null or btrim(new.name)='' then raise exception 'Stored marker requires a name'; end if;
    end if;
  end if;
  return new;
end;
$$;

alter table public.places drop constraint places_check,
  add constraint places_location_required check(google_place_id is not null or maps_url is not null or location is not null);
alter table public.route_map_places add constraint route_map_places_location_required
  check(google_place_id is not null or location is not null);
create unique index route_map_places_osm_reference_unique on public.route_map_places
  (route_map_id,(location->'reference'->>'id')) where location->>'source'='osm';
create trigger geo_row_guard before insert or update on public.regions for each row execute function sync_private.geo_row_guard();
create trigger geo_row_guard before insert or update on public.places for each row execute function sync_private.geo_row_guard();
create trigger geo_row_guard before insert or update on public.route_maps for each row execute function sync_private.geo_row_guard();
create trigger geo_row_guard before insert or update on public.route_map_places for each row execute function sync_private.geo_row_guard();

create function sync_private.geo_reference_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p record; m record; endpoint jsonb; provider text; row_data jsonb;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- Check final transaction state: a map may reference a marker created later in the same outbox task.
  for p in select * from public.places where id=case when tg_table_name='places' then (row_data->>'id')::uuid
      when tg_table_name='place_regions' then (row_data->>'place_id')::uuid else null end
      or id in (select place_id from public.place_regions where region_id=case when tg_table_name='regions' then (row_data->>'id')::uuid else null end)
  loop
    select case when count(*)>0 and bool_and(coalesce(r.map_provider,'google')='osm') then 'osm' else 'google' end into provider
      from public.place_regions pr join public.regions r on r.id=pr.region_id where pr.place_id=p.id;
    perform sync_private.validate_place_geo(jsonb_strip_nulls(jsonb_build_object('location',p.location,'googlePlaceId',p.google_place_id)),provider);
    if p.location is null and exists(select 1 from public.place_regions pr join public.regions r on r.id=pr.region_id
      where pr.place_id=p.id and r.map_provider='osm') then raise exception 'OSM regions require stored places'; end if;
  end loop;
  if tg_table_name='route_maps' then
    for m in select * from public.route_maps where id=new.id loop
      foreach endpoint in array array[m.origin,m.destination] loop
        if endpoint->>'kind'='place' and not exists(select 1 from public.places where id=(endpoint->>'placeId')::uuid and owner_uid=m.owner_uid) then
          raise exception 'Route endpoint place missing or belongs to another owner';
        elsif endpoint->>'kind'='route-map-place' and not exists(select 1 from public.route_map_places
          where id=(endpoint->>'routeMapPlaceId')::uuid and route_map_id=m.id and owner_uid=m.owner_uid) then
          raise exception 'Route endpoint marker missing or belongs to another map';
        elsif endpoint->>'kind'='shared-place' and not exists(
          select 1 from public.trip_shared_workspaces w join public.trips t on t.id=w.trip_id
          where w.trip_id=(endpoint->>'tripId')::uuid
            and (t.owner_uid=m.owner_uid or exists(select 1 from public.trip_members where trip_id=t.id and user_id=m.owner_uid)
              or exists(select 1 from public.user_roles where user_id=m.owner_uid and role='admin'))
            and exists(select 1 from jsonb_array_elements(w.places) sp where sp->>'id'=endpoint->>'placeId')) then
          raise exception 'Shared endpoint is unavailable to the map owner';
        end if;
      end loop;
    end loop;
  end if;
  return null;
end;
$$;
create constraint trigger geo_reference_guard after insert or update on public.places deferrable initially deferred
  for each row execute function sync_private.geo_reference_guard();
create constraint trigger geo_reference_guard after insert or update or delete on public.place_regions deferrable initially deferred
  for each row execute function sync_private.geo_reference_guard();
create constraint trigger geo_reference_guard after update on public.regions deferrable initially deferred
  for each row execute function sync_private.geo_reference_guard();
create constraint trigger geo_reference_guard after insert or update on public.route_maps deferrable initially deferred
  for each row execute function sync_private.geo_reference_guard();

create function sync_private.clear_endpoint_references()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target jsonb;
begin
  if tg_op='UPDATE' then
    if new.route_map_id=old.route_map_id then return new; end if;
  end if;
  target:=case when tg_table_name='places' then jsonb_build_object('kind','place','placeId',old.id)
    else jsonb_build_object('kind','route-map-place','routeMapPlaceId',old.id) end;
  update public.route_maps set
    origin=case when origin @> target then null else origin end,
    origin_google_place_id=case when origin @> target then null else origin_google_place_id end,
    destination=case when destination @> target then null else destination end,
    destination_google_place_id=case when destination @> target then null else destination_google_place_id end
    where origin @> target or destination @> target;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger clear_endpoint_references before delete on public.places for each row execute function sync_private.clear_endpoint_references();
create trigger clear_endpoint_references before delete or update of route_map_id on public.route_map_places
  for each row execute function sync_private.clear_endpoint_references();

revoke all on function sync_private.validate_location(jsonb,boolean),sync_private.validate_region_geo(jsonb),
  sync_private.validate_place_geo(jsonb,text),sync_private.endpoint_key(jsonb),sync_private.validate_map_geo(jsonb),
  sync_private.geo_row_guard(),sync_private.geo_reference_guard(),sync_private.clear_endpoint_references() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION sync_private.record(p_entity text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  case p_entity
  when 'regions' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'center',center,'googlePlaceId',google_place_id,'zoom',zoom,'mapProvider',map_provider,'centerMetadata',center_metadata))
    into result from public.regions where id=p_id;
  when 'labels' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'color',color,'parentId',parent_id))
    into result from public.labels where id=p_id;
  when 'places' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'icon',icon,'mapsUrl',maps_url,'googlePlaceId',google_place_id,'notes',notes,'location',location,
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
      'originGooglePlaceId',origin_google_place_id,'destinationGooglePlaceId',destination_google_place_id,'origin',origin,'destination',destination,'transport',transport))
    into result from public.route_maps where id=p_id;
  when 'routeMapPlaces' then
    select jsonb_strip_nulls(jsonb_build_object('id',id,'routeMapId',route_map_id,'googlePlaceId',google_place_id,'location',location,'name',name))
    into result from public.route_map_places where id=p_id;
  else raise exception 'Unsupported entity';
  end case;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_sync_push(p_task jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if (not (change ? 'baseVersion') or
      (change->>'baseVersion') is distinct from current_version.version::text)
      and not (entity_name='regions' and change->>'kind'='put' and change ? 'baseVersion'
        and change->>'baseVersion' is null and current_version.owner_uid=user_id
        and sync_private.record(entity_name,record_id)=change->'after') then
      conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',entity_name,'id',record_id,'version',current_version.version,
        'record',sync_private.record(entity_name,record_id)));
    end if;
    current_version:=null;
  end loop;
  if jsonb_array_length(conflicts)>0 then return jsonb_build_object('status','conflict','conflicts',conflicts); end if;
  set constraints public.geo_reference_guard deferred;
  select coalesce(max(sequence),0) into initial_sequence from sync_private.events;
  set constraints public.itinerary_items_trip_id_date_sort_order_key deferred;
  for change in
    select entry.value
    from jsonb_array_elements(p_task->'changes') with ordinality as entry(value, position)
    order by case when entry.value->>'entity' = 'trips'
      and entry.value->>'kind' = 'delete' then 0 else 1 end, entry.position
  loop
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
      when 'regions' then array['id','name','center','googlePlaceId','zoom','mapProvider','centerMetadata']
      when 'labels' then array['id','name','color','parentId']
      when 'places' then array['id','name','icon','mapsUrl','googlePlaceId','notes','regionIds','labelIds','location']
      when 'trips' then array['id','name','regionId','startDate','endDate']
      when 'itineraryItems' then array['id','tripId','placeId','date','order','arrivalTime','durationMinutes','transport','travelDurationMinutes','travelDistanceMeters','note']
      when 'routeMaps' then array['id','name','tripId','selectedDate','originGooglePlaceId','destinationGooglePlaceId','transport','origin','destination']
      else array['id','routeMapId','googlePlaceId','name','location'] end;
    if body is null or jsonb_typeof(body)<>'object' or body->>'id' is distinct from record_id::text
      or exists(select 1 from jsonb_object_keys(body) key where not(key=any(allowed))) then raise exception 'Invalid record or authorization fields'; end if;
    case entity_name
    when 'regions' then
      insert into public.regions(id,owner_uid,name,center,google_place_id,zoom,map_provider,center_metadata)
      values(record_id,user_id,body->>'name',body->'center',body->>'googlePlaceId',(body->>'zoom')::numeric,body->>'mapProvider',body->'centerMetadata')
      on conflict(id) do update set name=excluded.name,center=excluded.center,google_place_id=excluded.google_place_id,zoom=excluded.zoom,map_provider=excluded.map_provider,center_metadata=excluded.center_metadata;
    when 'labels' then
      insert into public.labels(id,owner_uid,name,color,parent_id)
      values(record_id,user_id,body->>'name',body->>'color',(body->>'parentId')::uuid)
      on conflict(id) do update set name=excluded.name,color=excluded.color,parent_id=excluded.parent_id;
    when 'places' then
      if jsonb_typeof(body->'regionIds') is distinct from 'array' or jsonb_typeof(body->'labelIds') is distinct from 'array' then raise exception 'Missing place relations'; end if;
      insert into public.places(id,owner_uid,name,icon,maps_url,google_place_id,notes,location)
      values(record_id,user_id,body->>'name',body->>'icon',body->>'mapsUrl',body->>'googlePlaceId',body->>'notes',body->'location')
      on conflict(id) do update set name=excluded.name,icon=excluded.icon,maps_url=excluded.maps_url,google_place_id=excluded.google_place_id,notes=excluded.notes,location=excluded.location;
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
      insert into public.route_maps(id,owner_uid,name,trip_id,selected_date,origin_google_place_id,destination_google_place_id,transport,origin,destination)
      values(record_id,user_id,body->>'name',(body->>'tripId')::uuid,(body->>'selectedDate')::date,
        body->>'originGooglePlaceId',body->>'destinationGooglePlaceId',body->>'transport',body->'origin',body->'destination')
      on conflict(id) do update set name=excluded.name,trip_id=excluded.trip_id,selected_date=excluded.selected_date,
        origin_google_place_id=excluded.origin_google_place_id,destination_google_place_id=excluded.destination_google_place_id,transport=excluded.transport,origin=excluded.origin,destination=excluded.destination;
    when 'routeMapPlaces' then
      insert into public.route_map_places(id,owner_uid,route_map_id,google_place_id,name,location)
      values(record_id,user_id,(body->>'routeMapId')::uuid,body->>'googlePlaceId',body->>'name',body->'location')
      on conflict(id) do update set route_map_id=excluded.route_map_id,google_place_id=excluded.google_place_id,name=excluded.name,location=excluded.location;
    end case;
  end loop;
  set constraints all immediate;
  select jsonb_build_object('status','applied','operationId',task_operation_id,'cursor',coalesce(max(sequence),initial_sequence)::text,
    'changes',coalesce(jsonb_agg(jsonb_build_object('entity',entity,'id',id,'version',version,'record',record,'sequence',sequence::text,'transactionId',transaction_id) order by sequence),'[]'::jsonb))
  into result from sync_private.events where owner_uid=user_id and sequence>initial_sequence;
  insert into sync_private.receipts(owner_uid,operation_id,payload,result) values(user_id,task_operation_id,p_task,result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_backup_assert_payload(p_backup jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_backup->>'format' <> 'travel-planner-backup' or backup_version not in (1, 2, 3) then
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
  if backup_version in (2, 3) then
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
      if backup_version < 3 and item ?| array['location','mapProvider','centerMetadata','origin','destination'] then
        raise exception 'Geo fields require backup version 3';
      end if;
      if entity='regions' then perform sync_private.validate_region_geo(item); end if;
      if entity='places' and item ? 'location' then
        perform sync_private.validate_location(item->'location');
      end if;
      if entity='routeMaps' then
        perform sync_private.validate_map_geo(item);
        if item->'origin'->>'kind'='shared-place' or item->'destination'->>'kind'='shared-place' then
          raise exception 'Private backup cannot include shared endpoints';
        end if;
      end if;
      if entity='routeMapPlaces' and item ? 'location' then
        perform sync_private.validate_location(item->'location');
        if nullif(btrim(item->>'name'),'') is null then raise exception 'Stored marker requires a name'; end if;
      end if;
      if item ?| forbidden then
        raise exception 'Backup payload data.% contains forbidden authorization fields.', entity;
      end if;
      if entity = 'routeMaps' and exists (
        select 1 from jsonb_object_keys(item) key
        where key not in ('id','name','tripId','selectedDate','originGooglePlaceId','destinationGooglePlaceId','transport','origin','destination')
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
        where key not in ('id','routeMapId','googlePlaceId','name','location')
      ) then raise exception 'Backup route-map place contains unsupported fields.'; end if;
      if entity = 'routeMapPlaces' and (
        not (item ?& array['id','routeMapId'])
        or jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(item->'routeMapId') is distinct from 'string'
        or item->>'routeMapId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (not item ? 'location' and not item ? 'googlePlaceId')
        or (item ? 'googlePlaceId' and (jsonb_typeof(item->'googlePlaceId') is distinct from 'string' or btrim(item->>'googlePlaceId') = ''))
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
    where route_map_place_entry->>'googlePlaceId' is not null
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
    select 1 from jsonb_array_elements(coalesce(data->'routeMaps','[]'::jsonb)) m
    cross join lateral (values(m->'origin'),(m->'destination')) endpoints(e)
    where (e->>'kind'='place' and not exists(select 1 from jsonb_array_elements(data->'places') p where p->>'id'=e->>'placeId'))
      or (e->>'kind'='route-map-place' and not exists(select 1 from jsonb_array_elements(data->'routeMapPlaces') p
        where p->>'id'=e->>'routeMapPlaceId' and p->>'routeMapId'=m->>'id'))
  ) then raise exception 'Backup route endpoint reference is missing'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(data->'trips', '[]'::jsonb)) trip_entry
    where trip_entry ? 'edit_mode' or trip_entry ? 'editMode'
  ) then raise exception 'Backup payload data.trips cannot specify sharing mode.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_backup_apply_replace(p_backup jsonb, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_backup->>'version' = '1' and exists (select 1 from public.route_maps where owner_uid=uid) then
    raise exception 'Version 1 backup cannot replace an account with route maps; use a version 2 backup.';
  end if;

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
    zoom numeric not null,
    map_provider text,
    center_metadata jsonb
  ) on commit drop;

  insert into stg_regions(old_id, new_id, name, center, google_place_id, zoom, map_provider, center_metadata)
  select (x.id)::uuid, gen_random_uuid(), x.name, x.center, x."googlePlaceId", x.zoom, x."mapProvider", x."centerMetadata"
  from jsonb_to_recordset(coalesce(data->'regions', '[]'::jsonb)) as x(
    id text,
    name text,
    center jsonb,
    "googlePlaceId" text,
    zoom numeric,
    "mapProvider" text,
    "centerMetadata" jsonb
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
    notes text,
    location jsonb
  ) on commit drop;

  insert into stg_places(old_id, new_id, name, icon, maps_url, google_place_id, notes, location)
  select (x.id)::uuid, gen_random_uuid(), x.name, x.icon, x."mapsUrl", x."googlePlaceId", x.notes, x.location
  from jsonb_to_recordset(coalesce(data->'places', '[]'::jsonb)) as x(
    id text,
    name text,
    icon text,
    "mapsUrl" text,
    "googlePlaceId" text,
    notes text,
    location jsonb
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


  create temporary table stg_route_maps (
    old_id uuid primary key,
    new_id uuid not null unique,
    trip_old_id uuid,
    name text not null,
    selected_date date,
    origin_google_place_id text,
    destination_google_place_id text,
    transport text not null,
    origin jsonb,
    destination jsonb
  ) on commit drop;

  insert into stg_route_maps(old_id,new_id,trip_old_id,name,selected_date,origin_google_place_id,destination_google_place_id,transport,origin,destination)
  select (x.id)::uuid,gen_random_uuid(),nullif(btrim(x."tripId"),'')::uuid,x.name,x."selectedDate"::date,
    x."originGooglePlaceId",x."destinationGooglePlaceId",x.transport,x.origin,x.destination
  from jsonb_to_recordset(coalesce(data->'routeMaps','[]'::jsonb)) as x(
    id text,name text,"tripId" text,"selectedDate" text,"originGooglePlaceId" text,"destinationGooglePlaceId" text,transport text,origin jsonb,destination jsonb
  );

  if exists (
    select 1 from stg_route_maps m
    where m.trip_old_id is not null and not exists (select 1 from stg_trips t where t.old_id=m.trip_old_id)
  ) then raise exception 'Backup route maps reference a missing trip.'; end if;

  create temporary table stg_route_map_places (
    old_id uuid primary key,
    new_id uuid not null unique,
    route_map_old_id uuid not null,
    google_place_id text,
    location jsonb,
    name text
  ) on commit drop;

  insert into stg_route_map_places(old_id,new_id,route_map_old_id,google_place_id,name,location)
  select (x.id)::uuid,gen_random_uuid(),(x."routeMapId")::uuid,x."googlePlaceId",x.name,x.location
  from jsonb_to_recordset(coalesce(data->'routeMapPlaces','[]'::jsonb)) as x(
    id text,"routeMapId" text,"googlePlaceId" text,name text,location jsonb
  );

  if exists (
    select 1 from stg_route_map_places p
    where not exists (select 1 from stg_route_maps m where m.old_id=p.route_map_old_id)
  ) then raise exception 'Backup route-map places reference a missing route map.'; end if;

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

  set constraints public.geo_reference_guard deferred;
  delete from public.itinerary_items where owner_uid = uid;
  delete from public.place_labels where owner_uid = uid;
  delete from public.place_regions where owner_uid = uid;
  delete from public.route_maps where owner_uid = uid;
  delete from public.trips where owner_uid = uid;
  delete from public.places where owner_uid = uid;
  delete from public.labels where owner_uid = uid;
  delete from public.regions where owner_uid = uid;

  insert into public.regions(id, owner_uid, name, center, google_place_id, zoom, map_provider, center_metadata)
  select new_id, uid, name, center, google_place_id, zoom, map_provider, center_metadata
  from stg_regions;

  insert into public.labels(id, owner_uid, name, color, parent_id)
  select l.new_id, uid, l.name, l.color, p.new_id
  from stg_labels l
  left join stg_labels p on p.old_id = l.parent_old_id;

  insert into public.places(id, owner_uid, name, icon, maps_url, google_place_id, notes, location)
  select new_id, uid, name, icon, maps_url, google_place_id, notes, location
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


  insert into public.route_maps(id,owner_uid,name,trip_id,selected_date,origin_google_place_id,destination_google_place_id,transport)
  select m.new_id,uid,m.name,t.new_id,m.selected_date,m.origin_google_place_id,m.destination_google_place_id,m.transport
  from stg_route_maps m
  left join stg_trips t on t.old_id=m.trip_old_id;

  insert into public.route_map_places(id,owner_uid,route_map_id,google_place_id,name,location)
  select p.new_id,uid,m.new_id,p.google_place_id,p.name,p.location
  from stg_route_map_places p
  join stg_route_maps m on m.old_id=p.route_map_old_id;

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

  update public.route_maps target set
    origin=case source.origin->>'kind'
      when 'place' then jsonb_set(source.origin,'{placeId}',to_jsonb((select new_id from stg_places where old_id=(source.origin->>'placeId')::uuid)))
      when 'route-map-place' then jsonb_set(source.origin,'{routeMapPlaceId}',to_jsonb((select new_id from stg_route_map_places where old_id=(source.origin->>'routeMapPlaceId')::uuid)))
      else source.origin end,
    destination=case source.destination->>'kind'
      when 'place' then jsonb_set(source.destination,'{placeId}',to_jsonb((select new_id from stg_places where old_id=(source.destination->>'placeId')::uuid)))
      when 'route-map-place' then jsonb_set(source.destination,'{routeMapPlaceId}',to_jsonb((select new_id from stg_route_map_places where old_id=(source.destination->>'routeMapPlaceId')::uuid)))
      else source.destination end
    from stg_route_maps source where target.id=source.new_id;
  set constraints public.geo_reference_guard immediate;
  result := public.app_backup_account_counts(uid);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_backup_account_signature(p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      jsonb_build_array(id,name,trip_id,selected_date,origin_google_place_id,destination_google_place_id,transport,origin,destination)
      order by id
    )::text), '') from public.route_maps where owner_uid = p_uid),
    (select count(*)::text from public.route_map_places where owner_uid = p_uid),
    (select coalesce(md5(jsonb_agg(jsonb_build_array(id,route_map_id,google_place_id,name,location) order by id)::text), '')
      from public.route_map_places where owner_uid = p_uid),
    (select coalesce(md5(jsonb_agg(jsonb_build_array(id,map_provider,center_metadata,center) order by id)::text),'')
      from public.regions where owner_uid=p_uid),
    (select coalesce(md5(jsonb_agg(jsonb_build_array(id,location) order by id)::text),'')
      from public.places where owner_uid=p_uid)
  ))
$function$;

CREATE OR REPLACE FUNCTION public.app_shared_trip(p_action text, p_trip_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid:=sync_private.authorize();
  trip public.trips%rowtype;
  workspace public.trip_shared_workspaces%rowtype;
  prior collaboration_private.shared_receipts%rowtype;
  role_value text;
  op uuid;
  output jsonb;
  new_places jsonb;
  new_items jsonb;
  topology_changed boolean;
begin
  if p_action is null or p_action not in ('snapshot','enable','save') then raise exception 'Unsupported shared trip action'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid shared trip payload'; end if;
  perform pg_advisory_xact_lock(741293,1);
  if p_action='snapshot' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',d.trip_id,'version',d.version::text,
      'document',collaboration_private.shared_document(d.trip_id)) order by d.trip_id)
      from (select trip_id,version from collaboration_private.shared_deliveries where user_id=uid
        union select trip_id,version from public.trip_shared_workspaces where public.app_is_admin()) d),'[]'::jsonb);
  end if;
  select * into trip from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Shared trip unavailable' using errcode='42501'; end if;
  select role into role_value from public.trip_members where trip_id=p_trip_id and user_id=uid;
  if trip.owner_uid=uid or public.app_is_admin() then role_value:='owner'; end if;
  if role_value is null or role_value='viewer' then raise exception 'Shared trip requires editor access' using errcode='42501'; end if;
  select * into workspace from public.trip_shared_workspaces where trip_id=p_trip_id;
  if p_action='enable' then
    if role_value<>'owner' then raise exception 'Only owner may enable shared editing' using errcode='42501'; end if;
    if workspace.trip_id is null then
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',p.id,'name',p.name,'icon',p.icon,
        'googlePlaceId',p.google_place_id,'mapsUrl',p.maps_url,'location',p.location)) order by p.id),'[]'::jsonb) into new_places
        from public.places p where exists(select 1 from public.itinerary_items i where i.trip_id=p_trip_id and i.place_id=p.id);
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',i.id,'placeId',i.place_id,'date',i.date,'order',i.sort_order,'arrivalTime',i.arrival_time,
        'durationMinutes',i.duration_minutes,'transport',i.transport,'travelDurationMinutes',i.travel_duration_minutes,
        'travelDistanceMeters',i.travel_distance_meters,'note',i.note)) order by i.date,i.sort_order,i.id),'[]'::jsonb)
        into new_items from public.itinerary_items i where i.trip_id=p_trip_id;
      insert into public.trip_shared_workspaces(trip_id,places,items,activated_by,updated_by)
        values(p_trip_id,new_places,new_items,uid,uid);
      update public.trips set edit_mode='shared' where id=p_trip_id;
      perform collaboration_private.shared_publish(p_trip_id);
    end if;
    return jsonb_build_object('enabled',true);
  end if;
  if workspace.trip_id is null then raise exception 'Owner must enable shared editing first'; end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('operationId','baseVersion','places','items'))
    or jsonb_typeof(p_payload->'operationId') is distinct from 'string'
    or jsonb_typeof(p_payload->'baseVersion') is distinct from 'string'
    or jsonb_typeof(p_payload->'places') is distinct from 'array'
    or jsonb_typeof(p_payload->'items') is distinct from 'array'
    or octet_length(p_payload::text)>900000
    or jsonb_array_length(p_payload->'places')>1000 or jsonb_array_length(p_payload->'items')>1000 then raise exception 'Invalid shared operation'; end if;
  op:=(p_payload->>'operationId')::uuid;
  select * into prior from collaboration_private.shared_receipts where user_id=uid and operation_id=op;
  if found then
    if prior.trip_id<>p_trip_id or prior.payload<>p_payload then raise exception 'Operation ID reused with different payload'; end if;
    return prior.result;
  end if;
  if workspace.version::text<>p_payload->>'baseVersion' then
    return jsonb_build_object('status','conflict','snapshot',jsonb_build_object(
      'id',p_trip_id,'version',workspace.version::text,'document',collaboration_private.shared_document(p_trip_id)));
  end if;
  new_places:=p_payload->'places'; new_items:=p_payload->'items';
  if exists(select 1 from jsonb_array_elements(new_places) p where jsonb_typeof(p)<>'object'
    or jsonb_typeof(p->'id') is distinct from 'string'
    or (p->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p->'name') is distinct from 'string' or btrim(p->>'name')=''
    or (not p ? 'location' and coalesce(nullif(btrim(p->>'googlePlaceId'),''),nullif(btrim(p->>'mapsUrl'),'')) is null)
    or (p ? 'googlePlaceId' and (jsonb_typeof(p->'googlePlaceId')<>'string' or btrim(p->>'googlePlaceId')=''))
    or (p ? 'mapsUrl' and (jsonb_typeof(p->'mapsUrl')<>'string' or p->>'mapsUrl' !~ '^https?://[^[:space:]]+$'))
    or (p ? 'icon' and (jsonb_typeof(p->'icon')<>'string' or p->>'icon' not in (
      '🍜','🍽️','☕','🍰','🏨','🏠','⛩️','🏛️','🏰','🏞️','🌳','🏖️','⛰️',
      '🎡','🛍️','🎨','🎭','📷','🚉','✈️','🚗','♨️')))
    or exists(select 1 from jsonb_object_keys(p) k where k not in ('id','name','icon','googlePlaceId','mapsUrl','location'))) then
      raise exception 'Invalid shared place'; end if;
  perform sync_private.validate_place_geo(p,coalesce((select map_provider from public.regions where id=trip.region_id),'google'))
    from jsonb_array_elements(new_places) p;
  if exists(select 1 from jsonb_array_elements(new_items) i where jsonb_typeof(i)<>'object'
    or jsonb_typeof(i->'id') is distinct from 'string'
    or i->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(i->'placeId') is distinct from 'string'
    or not exists(select 1 from jsonb_array_elements(new_places) p where p->>'id'=i->>'placeId')
    or jsonb_typeof(i->'date') is distinct from 'string' or i->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (i->>'date')::date not between trip.start_date and trip.end_date
    or jsonb_typeof(i->'order') is distinct from 'number' or i->>'order' !~ '^[0-9]+$'
    or (i ? 'arrivalTime' and (jsonb_typeof(i->'arrivalTime')<>'string' or i->>'arrivalTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
    or (i ? 'durationMinutes' and (jsonb_typeof(i->'durationMinutes')<>'number' or i->>'durationMinutes' !~ '^[1-9][0-9]*$'))
    or (i ? 'travelDurationMinutes' and (jsonb_typeof(i->'travelDurationMinutes')<>'number' or i->>'travelDurationMinutes' !~ '^[0-9]+$'))
    or (i ? 'travelDistanceMeters' and (jsonb_typeof(i->'travelDistanceMeters')<>'number' or i->>'travelDistanceMeters' !~ '^[0-9]+$'))
    or (i ? 'transport' and jsonb_typeof(i->'transport')<>'string')
    or (i ? 'note' and jsonb_typeof(i->'note')<>'string')
    or exists(select 1 from jsonb_object_keys(i) k where k not in ('id','placeId','date','order','arrivalTime',
      'durationMinutes','transport','travelDurationMinutes','travelDistanceMeters','note'))) then raise exception 'Invalid shared itinerary item'; end if;
  if (select count(*)<>count(distinct p->>'id') from jsonb_array_elements(new_places) p)
    or (select count(*)<>count(distinct i->>'id') from jsonb_array_elements(new_items) i)
    or exists(select 1 from jsonb_array_elements(new_items) i group by i->>'date',i->>'order' having count(*)>1) then raise exception 'Duplicate shared IDs or day order'; end if;
  -- Reject out-of-range integers before any write.
  perform (i->>'order')::integer,(i->>'durationMinutes')::integer,(i->>'travelDurationMinutes')::integer,
    (i->>'travelDistanceMeters')::bigint from jsonb_array_elements(new_items) i;
  if exists(select 1 from jsonb_array_elements(new_items) i where (i->>'travelDistanceMeters')::bigint>9007199254740991) then
    raise exception 'Shared distance exceeds safe integer range'; end if;
  select
    (select coalesce(jsonb_agg(jsonb_build_array(i->>'id',i->>'placeId',i->>'date',i->>'order',i->>'transport') order by i->>'id'),'[]'::jsonb) from jsonb_array_elements(workspace.items) i)
    is distinct from
    (select coalesce(jsonb_agg(jsonb_build_array(i->>'id',i->>'placeId',i->>'date',i->>'order',i->>'transport') order by i->>'id'),'[]'::jsonb) from jsonb_array_elements(new_items) i)
    or exists(select 1 from jsonb_array_elements(new_places) p join jsonb_array_elements(workspace.places) old on old->>'id'=p->>'id'
      where old->>'googlePlaceId' is distinct from p->>'googlePlaceId' or old->'location' is distinct from p->'location') into topology_changed;
  if topology_changed then
    select coalesce(jsonb_agg(i-'travelDurationMinutes'-'travelDistanceMeters'),'[]'::jsonb) into new_items from jsonb_array_elements(new_items) i;
  end if;
  update public.trip_shared_workspaces set places=new_places,items=new_items where trip_id=p_trip_id;
  perform collaboration_private.shared_publish(p_trip_id);
  select * into workspace from public.trip_shared_workspaces where trip_id=p_trip_id;
  output:=jsonb_build_object('status','applied','operationId',op,'snapshot',jsonb_build_object(
    'id',p_trip_id,'version',workspace.version::text,'document',collaboration_private.shared_document(p_trip_id)));
  insert into collaboration_private.shared_receipts values(uid,op,p_trip_id,p_payload,output);
  return output;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_cancel_shared_trip(p_action text, p_trip_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid:=sync_private.authorize();
  trip public.trips%rowtype;
  workspace public.trip_shared_workspaces%rowtype;
  prior collaboration_private.sharing_cancellations%rowtype;
  op uuid;
  place jsonb;
  item jsonb;
  personal_id uuid;
  item_id uuid;
  place_ids jsonb:='{}'::jsonb;
begin
  if p_action is distinct from 'cancel' or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or jsonb_typeof(p_payload->'operationId') is distinct from 'string'
    or jsonb_typeof(p_payload->'baseVersion') is distinct from 'string'
    or (p_payload->>'baseVersion') !~ '^[0-9]+$'
    or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('operationId','baseVersion')) then
    raise exception 'Invalid sharing cancellation payload';
  end if;
  op:=(p_payload->>'operationId')::uuid;
  perform pg_advisory_xact_lock(741293,1);
  select * into trip from public.trips where id=p_trip_id for update;
  if not found or (trip.owner_uid<>uid and not public.app_is_admin()) then
    raise exception 'Only owner may cancel sharing' using errcode='42501';
  end if;
  select * into prior from collaboration_private.sharing_cancellations where user_id=uid and operation_id=op;
  if found then
    if prior.trip_id<>p_trip_id or prior.base_version<>p_payload->>'baseVersion' then
      raise exception 'Cancellation operation already used with another payload';
    end if;
    return jsonb_build_object('cancelled',true);
  end if;
  select * into workspace from public.trip_shared_workspaces where trip_id=p_trip_id for update;
  if not found then raise exception 'Shared workspace unavailable; reload before cancelling'; end if;
  if workspace.version::text<>p_payload->>'baseVersion' then
    raise exception '共享行程已更新，未取消共享；請重新載入確認最新內容。';
  end if;

  insert into collaboration_private.sharing_cancellations(user_id,operation_id,trip_id,base_version,archive)
    values(uid,op,p_trip_id,workspace.version::text,jsonb_build_object(
      'workspace',to_jsonb(workspace),
      'originalItems',coalesce((select jsonb_agg(to_jsonb(i)) from public.itinerary_items i where trip_id=p_trip_id),'[]'::jsonb),
      'members',coalesce((select jsonb_agg(to_jsonb(m)) from public.trip_members m where trip_id=p_trip_id),'[]'::jsonb),
      'invitations',coalesce((select jsonb_agg(to_jsonb(i)) from public.trip_invitations i where trip_id=p_trip_id),'[]'::jsonb)));

  set constraints public.geo_reference_guard deferred;
  -- Reuse unchanged owner places; never overwrite a private collection's fields.
  for place in select value from jsonb_array_elements(workspace.places) loop
    personal_id:=null;
    select p.id into personal_id from public.places p
      where p.id=(place->>'id')::uuid and p.owner_uid=trip.owner_uid
        and p.name=place->>'name'
        and p.icon is not distinct from place->>'icon'
        and p.google_place_id is not distinct from place->>'googlePlaceId'
        and p.maps_url is not distinct from place->>'mapsUrl'
        and p.location is not distinct from place->'location';
    if personal_id is null then
      personal_id:=gen_random_uuid();
      insert into public.places(id,owner_uid,name,icon,google_place_id,maps_url,location)
        values(personal_id,trip.owner_uid,place->>'name',place->>'icon',place->>'googlePlaceId',place->>'mapsUrl',place->'location');
      insert into public.place_labels(place_id,label_id,owner_uid)
        select personal_id,label_id,trip.owner_uid from public.place_labels
          where place_id=(place->>'id')::uuid and owner_uid=trip.owner_uid;
      update public.places p set notes=original.notes from public.places original
        where p.id=personal_id and original.id=(place->>'id')::uuid and original.owner_uid=trip.owner_uid;
    end if;
    insert into public.place_regions(place_id,region_id,owner_uid)
      values(personal_id,trip.region_id,trip.owner_uid) on conflict(place_id,region_id) do nothing;
    place_ids:=place_ids||jsonb_build_object(place->>'id',personal_id);
  end loop;

  -- Remove the guard's shared source only inside this atomic copy-back transaction.
  delete from public.trip_shared_workspaces where trip_id=p_trip_id;
  delete from public.itinerary_items where trip_id=p_trip_id;
  for item in select value from jsonb_array_elements(workspace.items) loop
    item_id:=(item->>'id')::uuid;
    if exists(select 1 from public.itinerary_items where id=item_id) then item_id:=gen_random_uuid(); end if;
    insert into public.itinerary_items(id,trip_id,place_id,owner_uid,date,sort_order,arrival_time,
      duration_minutes,transport,travel_duration_minutes,travel_distance_meters,note)
      values(item_id,p_trip_id,(place_ids->>(item->>'placeId'))::uuid,trip.owner_uid,
        (item->>'date')::date,(item->>'order')::integer,item->>'arrivalTime',
        (item->>'durationMinutes')::integer,item->>'transport',(item->>'travelDurationMinutes')::integer,
        (item->>'travelDistanceMeters')::bigint,item->>'note');
  end loop;
  delete from public.trip_members where trip_id=p_trip_id;
  delete from public.trip_invitations where trip_id=p_trip_id;
  update public.trips set edit_mode='private',editor_uids='{}' where id=p_trip_id;
  update collaboration_private.shared_deliveries
    set version=nextval('collaboration_private.shared_revision') where trip_id=p_trip_id;
  set constraints public.geo_reference_guard immediate;
  return jsonb_build_object('cancelled',true);
end;
$function$;

CREATE OR REPLACE FUNCTION public_itinerary_private.validate_snapshot(s jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
    select s->'region', array['id','name','center','googlePlaceId','zoom','mapProvider','centerMetadata']
    union all select s->'trip', array['id','regionId','name','startDate','endDate']
    union all select value, array['id','name','icon','mapsUrl','googlePlaceId','regionIds','location'] from jsonb_array_elements(s->'places')
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
        or (s->'region'->>'zoom')::numeric not between 0 and 22
    or (s->'trip'->>'regionId') is distinct from (s->'region'->>'id')
    or s->'trip'->>'startDate' is null or s->'trip'->>'endDate' is null
    or (s->'trip'->>'startDate')::date > (s->'trip'->>'endDate')::date then
    raise exception 'Invalid public region or trip' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(s->'places') p
    where nullif(btrim(p->>'name'),'') is null
      or (not p ? 'location' and nullif(btrim(p->>'googlePlaceId'),'') is null and nullif(btrim(p->>'mapsUrl'),'') is null)
      or (p ? 'mapsUrl' and (p->>'mapsUrl') !~* '^https?://') or p->'regionIds' is distinct from jsonb_build_array(s->'region'->>'id'))
    or exists(select 1 from jsonb_array_elements(s->'places') p group by p->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(s->'items') i group by i->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(s->'items') i group by i->>'date',i->>'order' having count(*)>1)
    then raise exception 'Invalid public places or duplicate items' using errcode='22023'; end if;
  perform sync_private.validate_region_geo(s->'region');
  perform sync_private.validate_place_geo(p,coalesce(s->'region'->>'mapProvider','google')) from jsonb_array_elements(s->'places') p;
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
$function$;

CREATE OR REPLACE FUNCTION public_itinerary_private.api(action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    set constraints public.geo_reference_guard deferred;
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
    insert into public.regions(id,owner_uid,name,center,google_place_id,zoom,map_provider,center_metadata)
      values(region_id,uid,(node->>'name')||'(分享)',node->'center',node->>'googlePlaceId',(node->>'zoom')::numeric,node->>'mapProvider',node->'centerMetadata');
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
      insert into public.places(id,owner_uid,name,icon,maps_url,google_place_id,location)
        values(place_id,uid,node->>'name',node->>'icon',node->>'mapsUrl',node->>'googlePlaceId',node->'location');
      insert into public.place_regions(place_id,region_id,owner_uid) values(api_block.place_id,api_block.region_id,uid);
      insert into public.place_labels(place_id,label_id,owner_uid) values(api_block.place_id,api_block.label_id,uid);
    end loop;
    for item in select value from jsonb_array_elements(r.snapshot->'items') loop
      insert into public.itinerary_items(id,owner_uid,trip_id,place_id,date,sort_order,arrival_time,duration_minutes,transport,travel_duration_minutes,travel_distance_meters,note)
        values(gen_random_uuid(),uid,trip_id,(place_map->>(item->>'placeId'))::uuid,(item->>'date')::date,(item->>'order')::int,
        (item->>'arrivalTime')::time,(item->>'durationMinutes')::int,item->>'transport',(item->>'travelDurationMinutes')::int,(item->>'travelDistanceMeters')::bigint,item->>'note');
    end loop;
    set constraints public.geo_reference_guard immediate;
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
$function$;

create function public.app_save_place(p_id uuid,p_record jsonb,p_create boolean)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare previous public.places; parent uuid;
begin
  if auth.uid() is null or not public.app_is_member() then raise exception 'Member access required' using errcode='42501'; end if;
  if p_id is null or p_create is null or jsonb_typeof(p_record) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_record) k
      where k not in ('name','icon','mapsUrl','googlePlaceId','notes','regionIds','labelIds','location'))
    or jsonb_typeof(p_record->'regionIds') is distinct from 'array'
    or jsonb_typeof(p_record->'labelIds') is distinct from 'array' then raise exception 'Invalid place payload'; end if;
  set constraints public.geo_reference_guard deferred;
  perform pg_advisory_xact_lock(741293,1);
  if p_create then
    insert into public.places(id,name,icon,maps_url,google_place_id,notes,location)
      values(p_id,p_record->>'name',p_record->>'icon',p_record->>'mapsUrl',p_record->>'googlePlaceId',p_record->>'notes',p_record->'location');
  else
    select * into previous from public.places where id=p_id for update;
    if not found then raise exception 'Place unavailable' using errcode='P0002'; end if;
    update public.places set name=p_record->>'name',icon=p_record->>'icon',maps_url=p_record->>'mapsUrl',
      google_place_id=p_record->>'googlePlaceId',notes=p_record->>'notes',location=p_record->'location' where id=p_id;
    if previous.location is distinct from p_record->'location'
      or previous.google_place_id is distinct from p_record->>'googlePlaceId' then
      with ordered as (
        select id,place_id,lag(place_id) over(partition by trip_id,date order by sort_order) as predecessor
        from public.itinerary_items
      )
      update public.itinerary_items set travel_duration_minutes=null,travel_distance_meters=null
        where id in (select id from ordered where place_id=p_id or predecessor=p_id);
    end if;
  end if;
  delete from public.place_regions where place_id=p_id;
  delete from public.place_labels where place_id=p_id;
  for parent in select distinct value::uuid from jsonb_array_elements_text(p_record->'regionIds') loop
    insert into public.place_regions(place_id,region_id) values(p_id,parent);
  end loop;
  for parent in select distinct value::uuid from jsonb_array_elements_text(p_record->'labelIds') loop
    insert into public.place_labels(place_id,label_id) values(p_id,parent);
  end loop;
  set constraints public.geo_reference_guard immediate;
  return p_id;
end;
$$;
revoke all on function public.app_save_place(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.app_save_place(uuid,jsonb,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
