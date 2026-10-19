-- Keep validation and maintenance guards; shutdown shared writes non-destructively.
begin;
revoke all on function public.app_shared_trip(text,uuid,jsonb) from public,anon,authenticated;
commit;
