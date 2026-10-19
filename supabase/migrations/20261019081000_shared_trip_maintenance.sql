begin;
set local lock_timeout='10s';
set local statement_timeout='60s';

-- Private place changes may invalidate old travel estimates without editing the
-- retained schedule. Reject scheduling edits, not repository maintenance.
create or replace function collaboration_private.shared_legacy_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and
    (to_jsonb(new)-array['travel_duration_minutes','travel_distance_meters','updated_at','updated_by'])
      = (to_jsonb(old)-array['travel_duration_minutes','travel_distance_meters','updated_at','updated_by']) then
    return new;
  end if;
  if exists(select 1 from public.trip_shared_workspaces w join public.trips t on t.id=w.trip_id
    where w.trip_id=case when tg_op='DELETE' then old.trip_id else new.trip_id end)
    or (tg_op='UPDATE' and exists(select 1 from public.trip_shared_workspaces w where w.trip_id=old.trip_id)) then
    raise exception '此行程已啟用共同編輯，請使用共享行程；原始安排保留供復原，不再接受寫入。';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create function collaboration_private.shared_size_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare context_size integer;
begin
  select octet_length(to_jsonb(t)::text)+octet_length(sync_private.record('regions',t.region_id)::text)
    into context_size from public.trips t where t.id=new.trip_id;
  if jsonb_array_length(new.places)>1000 or jsonb_array_length(new.items)>1000 or
    octet_length(new.places::text)+octet_length(new.items::text)+coalesce(context_size,0)>800000 then
    raise exception '共享行程超過安全同步大小，未啟用或覆蓋資料。';
  end if;
  return new;
end;
$$;
create trigger shared_size_guard before insert or update of places,items on public.trip_shared_workspaces
  for each row execute function collaboration_private.shared_size_guard();
revoke all on function collaboration_private.shared_legacy_guard(),collaboration_private.shared_size_guard() from public,anon,authenticated;
commit;
