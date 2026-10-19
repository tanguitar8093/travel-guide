begin;
set local lock_timeout='10s';
set local statement_timeout='60s';
revoke execute on function public.app_cancel_shared_trip(text,uuid,jsonb) from authenticated;
commit;
