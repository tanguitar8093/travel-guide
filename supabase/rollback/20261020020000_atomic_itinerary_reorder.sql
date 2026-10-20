-- SHUTDOWN ONLY, not an exact restoration of a replaced historical RPC body or
-- its former privileges. Retain data, sync events, triggers, and all old APIs.
-- Permission denial intentionally does not activate the client's missing-RPC
-- fallback. Re-enabling/replacing the RPC requires a separately reviewed change.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
revoke all on function public.app_reorder_itinerary_items(uuid, date, uuid[])
  from public, anon, authenticated;
commit;