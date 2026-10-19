-- Disable email API without deleting invitations, members or business data.
begin;
set local lock_timeout = '10s';
revoke all on function public.app_trip_collaboration_v2(text,uuid,jsonb) from public,anon,authenticated;
commit;
