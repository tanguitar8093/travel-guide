-- Non-destructive emergency rollback: stop the API, retain ACLs, snapshots,
-- audit columns and the shared backup guard. Never restore "private" silently.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
revoke all on function public.app_trip_collaboration(text,uuid,jsonb) from public, anon, authenticated;
revoke all on public.trip_members, public.trip_invitations, public.trip_places from public, anon, authenticated;
alter table public.trip_members enable row level security;
alter table public.trip_invitations enable row level security;
alter table public.trip_places enable row level security;
commit;
