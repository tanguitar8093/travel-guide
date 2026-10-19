-- Preserve request/receipt identity; change only the execution order of deletes.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $migration$
declare
  definition text;
  old_fragment text := $old$  set constraints public.itinerary_items_trip_id_date_sort_order_key deferred;
  for change in select value from jsonb_array_elements(p_task->'changes') loop$old$;
  new_fragment text := $new$  set constraints public.itinerary_items_trip_id_date_sort_order_key deferred;
  for change in
    select entry.value
    from jsonb_array_elements(p_task->'changes') with ordinality as entry(value, position)
    order by case when entry.value->>'entity' = 'trips'
      and entry.value->>'kind' = 'delete' then 0 else 1 end, entry.position
  loop$new$;
begin
  perform pg_advisory_xact_lock(741293, 1);
  definition := pg_get_functiondef('public.app_sync_push(jsonb)'::regprocedure);
  if length(definition) - length(replace(definition, old_fragment, '')) <> length(old_fragment) then
    raise exception 'Unexpected sync push definition; reconcile the deployed function before applying the trip deletion fix.';
  end if;
  execute replace(definition, old_fragment, new_fragment);
end;
$migration$;

commit;
