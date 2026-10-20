-- Narrowed package: postgres defaults/existing ACLs precede this RPC. Retained
-- platform defaults are untouched; future platform objects still need review.
-- Incremental repair only: do not replay the repository baseline.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(741293, 1);

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
  trip public.trips%rowtype;
  day_count bigint;
  input_count integer;
  previous_places jsonb;
  changed_predecessors uuid[];
begin
  if uid is null or public.app_is_member() is distinct from true then
    raise exception 'Reorder requires member or admin access' using errcode = '42501';
  end if;

  -- Same lock, and same lock-before-row-lock ordering, as personal/shared sync
  -- and the statement-level triggers on direct business-table writes.
  perform pg_catalog.pg_advisory_xact_lock(741293, 1);
  select * into trip from public.trips where id = p_trip_id for update;
  if not found or (trip.owner_uid <> uid and public.app_is_admin() is distinct from true) then
    raise exception '目前沒有權限編輯此行程。' using errcode = '42501';
  end if;

  -- The row trigger alone cannot protect an empty day (nor an unchanged row).
  -- Never disable shared_legacy_guard or write the retained private schedule.
  if exists (select 1 from public.trip_shared_workspaces where trip_id = p_trip_id) then
    raise exception '此行程已啟用共同編輯，請使用共享行程；原始安排保留供復原，不再接受寫入。';
  end if;
  if p_date is null or not pg_catalog.isfinite(p_date)
    or p_date < trip.start_date or p_date > trip.end_date then
    raise exception 'Itinerary item date must be within the trip dates.';
  end if;
  if p_ordered_ids is null
    or (pg_catalog.cardinality(p_ordered_ids) > 0 and
      (pg_catalog.array_ndims(p_ordered_ids) <> 1 or pg_catalog.array_lower(p_ordered_ids, 1) <> 1)) then
    raise exception 'Invalid reordered itinerary ID array';
  end if;
  input_count := pg_catalog.cardinality(p_ordered_ids);

  -- Protect place/date/order/estimate inputs from direct concurrent item edits.
  -- The global statement lock also serializes inserts into an otherwise empty day.
  perform id from public.itinerary_items
    where trip_id = p_trip_id and date = p_date order by id for update;
  select count(*) into day_count from public.itinerary_items
    where trip_id = p_trip_id and date = p_date;
  if input_count <> day_count
    or (select count(distinct item_id) from pg_catalog.unnest(p_ordered_ids) input(item_id)) <> input_count
    or exists (
      select 1 from pg_catalog.unnest(p_ordered_ids) input(item_id)
      left join public.itinerary_items i on i.id = input.item_id
        and i.trip_id = p_trip_id and i.date = p_date
      where i.id is null
    ) then
    raise exception 'The reordered itinerary items do not match this trip day.';
  end if;
  if input_count = 0 then return; end if;

  -- The sync migration makes this constraint DEFERRABLE INITIALLY IMMEDIATE.
  -- Fail closed on schema drift rather than assume SET CONSTRAINTS can work.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.itinerary_items'::pg_catalog.regclass
      and conname = 'itinerary_items_trip_id_date_sort_order_key'
      and contype = 'u' and condeferrable
  ) then
    raise exception 'Atomic reorder requires the deferrable itinerary order constraint';
  end if;
  -- Temporary orders are [n, 2*n-1], independent of the existing maximum.
  -- Use bigint arithmetic and reject impossible integer scratch-space sizes.
  if day_count > 1073741824 then
    raise exception 'Too many itinerary items to reorder safely';
  end if;

  -- Materialize the OLD predecessor place IDs before either UPDATE. Comparing
  -- places, not item IDs or positions, preserves still-valid incoming estimates.
  select jsonb_object_agg(id::text, previous_place_id) into previous_places
  from (
    select id, lag(place_id) over (order by sort_order, id) as previous_place_id
    from public.itinerary_items where trip_id = p_trip_id and date = p_date
  ) before_order;
  select coalesce(array_agg(id), '{}'::uuid[]) into changed_predecessors
  from (
    select i.id, lag(i.place_id) over (order by input.ordinality) as previous_place_id
    from pg_catalog.unnest(p_ordered_ids) with ordinality input(item_id, ordinality)
    join public.itinerary_items i on i.id = input.item_id
  ) after_order
  where (previous_places ->> id::text)::uuid is distinct from previous_place_id;

  -- Two separate SQL commands, NOT a data-modifying CTE updating rows twice.
  -- Deferral allows scratch orders to overlap OLD orders, even INT_MAX ones.
  set constraints public.itinerary_items_trip_id_date_sort_order_key deferred;
  update public.itinerary_items i
  set sort_order = (day_count + input.ordinality - 1)::integer
  from pg_catalog.unnest(p_ordered_ids) with ordinality input(item_id, ordinality)
  where i.id = input.item_id;
  set constraints public.itinerary_items_trip_id_date_sort_order_key immediate;

  -- Scratch orders are disjoint from [0,n-1], so this phase is immediate-safe.
  update public.itinerary_items i
  set sort_order = (input.ordinality - 1)::integer,
      travel_duration_minutes = case when i.id = any(changed_predecessors)
        then null else i.travel_duration_minutes end,
      travel_distance_meters = case when i.id = any(changed_predecessors)
        then null else i.travel_distance_meters end
  from pg_catalog.unnest(p_ordered_ids) with ordinality input(item_id, ordinality)
  where i.id = input.item_id;
  -- Existing sync triggers remain enabled: both phases and their events/versions
  -- commit together, or all roll back on any failure. No shared/local path changes.
end;
$$;

-- The captured postgres nonclient default grants service_role EXECUTE too.
-- Keep that default untouched; this new RPC has an explicit two-role contract.
-- Unknown grantees/options still fail the exact source gate below.
revoke all on function public.app_reorder_itinerary_items(uuid, date, uuid[]) from public, anon, service_role;
grant execute on function public.app_reorder_itinerary_items(uuid, date, uuid[]) to authenticated;
-- Reinstallation must not silently preserve an unreviewed grantee, grantor or
-- grant option on an already-existing RPC. Never repair arbitrary parent roles.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_proc p
      where p.oid='public.app_reorder_itinerary_items(uuid,date,uuid[])'::regprocedure
        and p.proowner='postgres'::regrole)
    or (select count(*) from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(p.proacl) a
      where p.oid='public.app_reorder_itinerary_items(uuid,date,uuid[])'::regprocedure) <> 2
    or exists (select 1 from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(p.proacl) a
      where p.oid='public.app_reorder_itinerary_items(uuid,date,uuid[])'::regprocedure
        and (a.grantor <> 'postgres'::regrole or a.is_grantable
          or a.privilege_type <> 'EXECUTE'
          or a.grantee not in ('postgres'::regrole,'authenticated'::regrole))) then
    raise exception 'Atomic reorder blocked: unapproved RPC owner/ACL source' using errcode='42501';
  end if;
end;
$$;
commit;