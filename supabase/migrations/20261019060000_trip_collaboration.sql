-- Additive ACL/read-only preview foundation. Existing owner CRUD and sync remain
-- authoritative for content; editor membership does not grant content writes.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('viewer', 'editor')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members(user_id);

create table public.trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete restrict,
  invitee_user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('viewer', 'editor')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index trip_invitations_recipient_idx on public.trip_invitations(invitee_user_id, trip_id);
create index trip_invitations_trip_idx on public.trip_invitations(trip_id);

create table public.trip_places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  icon text,
  google_place_id text,
  maps_url text,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, trip_id)
);
create index trip_places_trip_idx on public.trip_places(trip_id);

alter table public.trips
  add column acl_version bigint not null default 0,
  add column updated_by uuid references auth.users(id) on delete restrict;
alter table public.itinerary_items
  add column created_by uuid references auth.users(id) on delete restrict,
  add column updated_by uuid references auth.users(id) on delete restrict,
  add column trip_place_id uuid,
  add constraint itinerary_trip_place_scope_fkey foreign key (trip_place_id, trip_id)
    references public.trip_places(id, trip_id) on delete restrict;
alter table public.route_maps
  add column created_by uuid references auth.users(id) on delete restrict,
  add column updated_by uuid references auth.users(id) on delete restrict;
alter table public.route_map_places
  add column created_by uuid references auth.users(id) on delete restrict,
  add column updated_by uuid references auth.users(id) on delete restrict,
  add column updated_at timestamptz not null default now();

-- No policies or table grants: even members/admins must use the checked RPC.
alter table public.trip_members enable row level security;
alter table public.trip_invitations enable row level security;
alter table public.trip_places enable row level security;
revoke all on public.trip_members, public.trip_invitations, public.trip_places from public, anon, authenticated;

create schema collaboration_private;
revoke all on schema collaboration_private from public, anon, authenticated;

create function collaboration_private.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'trips' then
    if tg_op = 'UPDATE' then
      if new.id is distinct from old.id then raise exception 'Trip identity is immutable'; end if;
      -- Only nested ACL-table triggers advance this informational revision.
      if pg_trigger_depth() = 1 then new.acl_version := old.acl_version; end if;
    else
      new.acl_version := 0;
    end if;
    if exists (select 1 from public.trip_members m where m.trip_id = new.id)
       or exists (select 1 from public.trip_invitations i where i.trip_id = new.id) then
      new.edit_mode := 'shared';
    end if;
  else
    if tg_op = 'INSERT' then new.created_by := auth.uid();
    else new.created_by := old.created_by;
    end if;
    new.updated_at := now();
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;

create function collaboration_private.acl_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  target := case when tg_op = 'DELETE' then old.trip_id else new.trip_id end;
  update public.trips set acl_version = acl_version + 1, edit_mode = 'shared' where id = target;
  return null;
end;
$$;
revoke all on function collaboration_private.audit(), collaboration_private.acl_changed() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['trips','itinerary_items','route_maps','route_map_places','trip_places'] loop
    execute format('create trigger collaboration_audit before insert or update on public.%I for each row execute function collaboration_private.audit()', t);
  end loop;
  foreach t in array array['trip_members','trip_invitations'] loop
    execute format('create trigger collaboration_lock before insert or update or delete on public.%I for each statement execute function sync_private.lock_writes()', t);
    execute format('create trigger collaboration_acl after insert or update or delete on public.%I for each row execute function collaboration_private.acl_changed()', t);
  end loop;
end;
$$;

create function public.app_trip_collaboration(
  p_action text,
  p_trip_id uuid default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  trip public.trips%rowtype;
  invitation public.trip_invitations%rowtype;
  manager boolean;
  access_role text;
  target uuid;
  desired_role text;
  expiry timestamptz;
  result jsonb;
begin
  if uid is null or not public.app_is_member() then
    raise exception 'Collaboration requires member or admin access' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('list','details','invite','accept','revoke_invitation','set_member','remove_member','leave') then
    raise exception 'Unsupported collaboration action';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Payload must be an object'; end if;
  -- Same ordering as sync/backup: global transaction lock before row locks.
  perform pg_advisory_xact_lock(741293, 1);

  if p_action = 'list' then
    return jsonb_build_object(
      'trips', coalesce((select jsonb_agg(jsonb_build_object(
        'id',t.id,'name',t.name,'regionId',t.region_id,'startDate',t.start_date,'endDate',t.end_date,
        'ownerUid',t.owner_uid,'access',case when t.owner_uid=uid or public.app_is_admin() then 'owner' else m.role end,
        'aclVersion',t.acl_version::text) order by t.created_at,t.id)
        from public.trips t left join public.trip_members m on m.trip_id=t.id and m.user_id=uid
        where t.owner_uid=uid or public.app_is_admin() or m.user_id is not null),'[]'::jsonb),
      'invitations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'tripId',i.trip_id,'tripName',t.name,'invitedBy',i.invited_by,'inviteeUserId',i.invitee_user_id,
        'role',i.role,'expiresAt',i.expires_at,'acceptedAt',i.accepted_at,'revokedAt',i.revoked_at,'createdAt',i.created_at)
        order by i.created_at,i.id) from public.trip_invitations i join public.trips t on t.id=i.trip_id
        where i.invitee_user_id=uid and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()),'[]'::jsonb));
  end if;

  select * into trip from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Trip unavailable' using errcode='42501'; end if;
  manager := trip.owner_uid=uid or public.app_is_admin();
  select role into access_role from public.trip_members where trip_id=p_trip_id and user_id=uid;
  if manager then access_role := 'owner'; end if;

  if p_action = 'details' then
    if access_role is null then raise exception 'Trip unavailable' using errcode='42501'; end if;
    select jsonb_build_object(
      'trip',jsonb_build_object('id',trip.id,'name',trip.name,'regionId',trip.region_id,
        'startDate',trip.start_date,'endDate',trip.end_date,'ownerUid',trip.owner_uid,'access',access_role,'aclVersion',trip.acl_version::text),
      'members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'role',m.role,
        'createdBy',m.created_by,'createdAt',m.created_at) order by m.user_id) from public.trip_members m where m.trip_id=p_trip_id),'[]'::jsonb),
      'invitations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'tripId',i.trip_id,'tripName',trip.name,'invitedBy',i.invited_by,'inviteeUserId',i.invitee_user_id,
        'role',i.role,'expiresAt',i.expires_at,'acceptedAt',i.accepted_at,'revokedAt',i.revoked_at,'createdAt',i.created_at)
        order by i.created_at,i.id) from public.trip_invitations i where i.trip_id=p_trip_id and (manager or i.invitee_user_id=uid)),'[]'::jsonb),
      -- Legacy personal place notes/labels/region associations and item notes
      -- are never projected. Only places actually referenced by this trip.
      'places',coalesce((select jsonb_agg(p.record order by p.id) from (
        select l.id,jsonb_build_object('id',l.id,'name',l.name,'icon',l.icon,'googlePlaceId',l.google_place_id,'mapsUrl',l.maps_url) record
        from public.places l where exists (select 1 from public.itinerary_items i where i.trip_id=p_trip_id and i.place_id=l.id and i.trip_place_id is null)
        union all
        select s.id,jsonb_build_object('id',s.id,'name',s.name,'icon',s.icon,'googlePlaceId',s.google_place_id,'mapsUrl',s.maps_url)
        from public.trip_places s where s.trip_id=p_trip_id
      ) p),'[]'::jsonb),
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'tripId',i.trip_id,'placeId',coalesce(i.trip_place_id,i.place_id),
        'date',i.date,'order',i.sort_order,'arrivalTime',i.arrival_time,'durationMinutes',i.duration_minutes,
        'transport',i.transport,'travelDurationMinutes',i.travel_duration_minutes,'travelDistanceMeters',i.travel_distance_meters)
        order by i.date,i.sort_order) from public.itinerary_items i where i.trip_id=p_trip_id),'[]'::jsonb),
      'region',(select jsonb_strip_nulls(jsonb_build_object('id',r.id,'name',r.name,'googlePlaceId',r.google_place_id,
        'zoom',r.zoom,'center',r.center)) from public.regions r where r.id=trip.region_id),
      -- Endpoints/markers of the explicitly linked trip map are shared, not
      -- standalone maps or the owner's other saved places.
      'routeMaps',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'tripId',r.trip_id,
        'selectedDate',r.selected_date,'originGooglePlaceId',r.origin_google_place_id,
        'destinationGooglePlaceId',r.destination_google_place_id,'transport',r.transport))
        from public.route_maps r where r.trip_id=p_trip_id),'[]'::jsonb),
      'routeMapPlaces',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'routeMapId',p.route_map_id,
        'googlePlaceId',p.google_place_id,'name',p.name)) from public.route_map_places p
        join public.route_maps r on r.id=p.route_map_id where r.trip_id=p_trip_id),'[]'::jsonb)
    ) into result;
    return result;
  end if;

  -- Reject unknown fields rather than silently accepting owner/trip spoofing.
  if exists (select 1 from jsonb_object_keys(p_payload) k where not (
    (p_action='invite' and k in ('inviteeUserId','role','expiresAt')) or
    (p_action in ('accept','revoke_invitation') and k='invitationId') or
    (p_action='set_member' and k in ('userId','role')) or
    (p_action='remove_member' and k='userId')
  )) then raise exception 'Unexpected collaboration payload fields'; end if;
  if p_action in ('invite','revoke_invitation','set_member','remove_member') and not manager then
    raise exception 'Only owner or admin may manage collaboration' using errcode='42501';
  end if;
  if p_action in ('invite','set_member') then
    desired_role := p_payload->>'role';
    if desired_role is null or desired_role not in ('viewer','editor') then raise exception 'Invalid collaboration role'; end if;
  end if;

  if p_action = 'invite' then
    target := (p_payload->>'inviteeUserId')::uuid;
    if target is null or target=trip.owner_uid or not exists (
      select 1 from public.user_roles r where r.user_id=target and r.role in ('member','admin')
    ) then raise exception 'Invitee must be another registered member'; end if;
    if exists (select 1 from public.trip_members m where m.trip_id=p_trip_id and m.user_id=target) then raise exception 'User is already a member'; end if;
    expiry := coalesce((p_payload->>'expiresAt')::timestamptz,now()+interval '7 days');
    if expiry<=now() or expiry>now()+interval '30 days' then raise exception 'Invitation expiry must be within 30 days'; end if;
    -- Retrying a pending invite returns the original ID, never escalates role.
    select * into invitation from public.trip_invitations i where i.trip_id=p_trip_id
      and i.invitee_user_id=target and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
      order by i.created_at,i.id limit 1;
    if found then
      if invitation.role<>desired_role then raise exception 'Revoke existing invitation before changing its role'; end if;
    else
      insert into public.trip_invitations(trip_id,invited_by,invitee_user_id,role,expires_at)
        values(p_trip_id,uid,target,desired_role,expiry) returning * into invitation;
    end if;
  elsif p_action in ('accept','revoke_invitation') then
    select * into invitation from public.trip_invitations i
      where i.id=(p_payload->>'invitationId')::uuid and i.trip_id=p_trip_id for update;
    if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
    if p_action='accept' then
      if invitation.invitee_user_id<>uid then raise exception 'Invitation unavailable' using errcode='42501'; end if;
      if invitation.revoked_at is not null or invitation.expires_at<=now() then raise exception 'Invitation is revoked or expired'; end if;
      if invitation.accepted_at is null then
        insert into public.trip_members(trip_id,user_id,role,created_by)
          values(p_trip_id,uid,invitation.role,invitation.invited_by) on conflict(trip_id,user_id) do nothing;
        update public.trip_invitations set accepted_at=now() where id=invitation.id;
      elsif not exists (select 1 from public.trip_members m where m.trip_id=p_trip_id and m.user_id=uid) then
        raise exception 'Accepted invitation cannot restore removed membership';
      end if;
    elsif invitation.revoked_at is null then
      update public.trip_invitations set revoked_at=now() where id=invitation.id;
    end if;
  elsif p_action in ('set_member','remove_member') then
    target := (p_payload->>'userId')::uuid;
    if target is null or target=trip.owner_uid then raise exception 'Owner membership is immutable'; end if;
    if p_action='set_member' then
      update public.trip_members set role=desired_role where trip_id=p_trip_id and user_id=target and role<>desired_role;
      if not exists (select 1 from public.trip_members m where m.trip_id=p_trip_id and m.user_id=target) then
        raise exception 'User must accept an invitation first';
      end if;
    else
      delete from public.trip_members where trip_id=p_trip_id and user_id=target;
      update public.trip_invitations set revoked_at=now() where trip_id=p_trip_id and invitee_user_id=target and revoked_at is null;
    end if;
  elsif p_action='leave' then
    if trip.owner_uid=uid then raise exception 'Owner cannot leave their trip'; end if;
    delete from public.trip_members where trip_id=p_trip_id and user_id=uid;
    update public.trip_invitations set revoked_at=now() where trip_id=p_trip_id and invitee_user_id=uid and revoked_at is null;
  end if;
  select jsonb_build_object('ok',true,'aclVersion',t.acl_version::text) into result from public.trips t where t.id=p_trip_id;
  if p_action in ('invite','accept','revoke_invitation') then result := result || jsonb_build_object('invitationId',invitation.id); end if;
  return result;
end;
$$;
revoke all on function public.app_trip_collaboration(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.app_trip_collaboration(text,uuid,jsonb) to authenticated;
commit;
