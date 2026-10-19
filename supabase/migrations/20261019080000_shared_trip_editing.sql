begin;
set local lock_timeout='10s';
set local statement_timeout='60s';

create sequence collaboration_private.shared_revision;
create table public.trip_shared_workspaces (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  version bigint not null default nextval('collaboration_private.shared_revision'),
  places jsonb not null check(jsonb_typeof(places)='array'),
  items jsonb not null check(jsonb_typeof(items)='array'),
  activated_by uuid not null references auth.users(id),
  activated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table collaboration_private.shared_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null,
  version bigint not null,
  primary key(user_id,trip_id)
);
create table collaboration_private.shared_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  trip_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  primary key(user_id,operation_id)
);
alter table public.trip_shared_workspaces enable row level security;
alter table collaboration_private.shared_deliveries enable row level security;
alter table collaboration_private.shared_receipts enable row level security;
revoke all on public.trip_shared_workspaces,collaboration_private.shared_deliveries,
  collaboration_private.shared_receipts from public,anon,authenticated;
revoke all on sequence collaboration_private.shared_revision from public,anon,authenticated;

create function collaboration_private.shared_publish(p_trip_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare rev bigint;
begin
  update public.trip_shared_workspaces set version=nextval('collaboration_private.shared_revision'),
    updated_by=coalesce(auth.uid(),updated_by),updated_at=now() where trip_id=p_trip_id returning version into rev;
  if rev is null then return; end if;
  update collaboration_private.shared_deliveries set version=rev where trip_id=p_trip_id;
  insert into collaboration_private.shared_deliveries(user_id,trip_id,version)
    select owner_uid,id,rev from public.trips where id=p_trip_id
    union select user_id,trip_id,rev from public.trip_members where trip_id=p_trip_id
    on conflict(user_id,trip_id) do update set version=excluded.version;
end;
$$;
create function collaboration_private.shared_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(741293,1);
  if tg_table_name='trips' then
    if tg_op='DELETE' then
      update collaboration_private.shared_deliveries set version=nextval('collaboration_private.shared_revision') where trip_id=old.id;
    else perform collaboration_private.shared_publish(new.id);
    end if;
  elsif tg_table_name='regions' then
    perform collaboration_private.shared_publish(t.id) from public.trips t where t.region_id=new.id;
  else perform collaboration_private.shared_publish(case when tg_op='DELETE' then old.trip_id else new.trip_id end);
  end if;
  return null;
end;
$$;
create trigger shared_members_changed after insert or update or delete on public.trip_members
  for each row execute function collaboration_private.shared_changed();
create trigger shared_trip_changed after update or delete on public.trips
  for each row execute function collaboration_private.shared_changed();
create trigger shared_region_changed after update on public.regions
  for each row execute function collaboration_private.shared_changed();

create function collaboration_private.shared_document(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; uid uuid:=auth.uid();
begin
  select jsonb_build_object('trip',jsonb_build_object(
    'id',t.id,'name',t.name,'regionId',t.region_id,'startDate',t.start_date,'endDate',t.end_date,
    'ownerUid',t.owner_uid,'access',case when t.owner_uid=uid or public.app_is_admin() then 'owner' else m.role end,
    'aclVersion',t.acl_version::text),'region',sync_private.record('regions',t.region_id),
    'places',w.places,'items',w.items) into result
    from public.trips t join public.trip_shared_workspaces w on w.trip_id=t.id
    left join public.trip_members m on m.trip_id=t.id and m.user_id=uid
    where t.id=p_trip_id and (t.owner_uid=uid or public.app_is_admin() or m.user_id is not null);
  return result;
end;
$$;

create function public.app_shared_trip(p_action text,p_trip_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
        'googlePlaceId',p.google_place_id,'mapsUrl',p.maps_url)) order by p.id),'[]'::jsonb) into new_places
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
    or coalesce(nullif(btrim(p->>'googlePlaceId'),''),nullif(btrim(p->>'mapsUrl'),'')) is null
    or (p ? 'googlePlaceId' and (jsonb_typeof(p->'googlePlaceId')<>'string' or btrim(p->>'googlePlaceId')=''))
    or (p ? 'mapsUrl' and (jsonb_typeof(p->'mapsUrl')<>'string' or p->>'mapsUrl' !~ '^https?://[^[:space:]]+$'))
    or (p ? 'icon' and (jsonb_typeof(p->'icon')<>'string' or p->>'icon' not in (
      '🍜','🍽️','☕','🍰','🏨','🏠','⛩️','🏛️','🏰','🏞️','🌳','🏖️','⛰️',
      '🎡','🛍️','🎨','🎭','📷','🚉','✈️','🚗','♨️')))
    or exists(select 1 from jsonb_object_keys(p) k where k not in ('id','name','icon','googlePlaceId','mapsUrl'))) then
      raise exception 'Invalid shared place'; end if;
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
      where old->>'googlePlaceId' is distinct from p->>'googlePlaceId') into topology_changed;
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
$$;

create function collaboration_private.shared_legacy_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.trip_shared_workspaces w join public.trips t on t.id=w.trip_id
    where w.trip_id=case when tg_op='DELETE' then old.trip_id else new.trip_id end)
    or (tg_op='UPDATE' and exists(select 1 from public.trip_shared_workspaces w where w.trip_id=old.trip_id)) then
    raise exception '此行程已啟用共同編輯，請使用共享行程；原始安排保留供復原，不再接受寫入。';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger shared_legacy_guard before insert or update or delete on public.itinerary_items
  for each row execute function collaboration_private.shared_legacy_guard();
create function collaboration_private.shared_dates_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.trip_shared_workspaces w cross join lateral jsonb_array_elements(w.items) i
    where w.trip_id=new.id and (i->>'date')::date not between new.start_date and new.end_date) then
    raise exception '行程日期不能排除已安排的共享項目。'; end if;
  return new;
end;
$$;
create trigger shared_dates_guard before update on public.trips
  for each row execute function collaboration_private.shared_dates_guard();
revoke all on function collaboration_private.shared_publish(uuid),collaboration_private.shared_changed(),
  collaboration_private.shared_document(uuid),collaboration_private.shared_legacy_guard(),
  collaboration_private.shared_dates_guard() from public,anon,authenticated;
revoke all on function public.app_shared_trip(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.app_shared_trip(text,uuid,jsonb) to authenticated;
commit;
