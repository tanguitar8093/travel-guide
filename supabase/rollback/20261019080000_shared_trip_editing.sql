-- Shutdown only; shared content and original itinerary rows are retained.
begin;
revoke all on function public.app_shared_trip(text,uuid,jsonb) from public,anon,authenticated;
commit;
