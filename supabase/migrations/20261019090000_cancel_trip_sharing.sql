begin;
set local lock_timeout='10s';
set local statement_timeout='60s';

create table collaboration_private.sharing_cancellations (
  user_id uuid not null,
  operation_id uuid not null,
  trip_id uuid not null,
  base_version text not null,
  archive jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);
alter table collaboration_private.sharing_cancellations enable row level security;
revoke all on collaboration_private.sharing_cancellations from public,anon,authenticated;

create function public.app_cancel_shared_trip(p_action text,p_trip_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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

  -- Reuse unchanged owner places; never overwrite a private collection's fields.
  for place in select value from jsonb_array_elements(workspace.places) loop
    personal_id:=null;
    select p.id into personal_id from public.places p
      where p.id=(place->>'id')::uuid and p.owner_uid=trip.owner_uid
        and p.name=place->>'name'
        and p.icon is not distinct from place->>'icon'
        and p.google_place_id is not distinct from place->>'googlePlaceId'
        and p.maps_url is not distinct from place->>'mapsUrl';
    if personal_id is null then
      personal_id:=gen_random_uuid();
      insert into public.places(id,owner_uid,name,icon,google_place_id,maps_url)
        values(personal_id,trip.owner_uid,place->>'name',place->>'icon',place->>'googlePlaceId',place->>'mapsUrl');
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
  return jsonb_build_object('cancelled',true);
end;
$$;
revoke all on function public.app_cancel_shared_trip(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.app_cancel_shared_trip(text,uuid,jsonb) to authenticated;
commit;
