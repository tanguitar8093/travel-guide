-- Disable public sharing/sync endpoints only. Preserve public snapshots, receipts and personal copies.
begin;
revoke all on function public.app_public_itinerary(text,jsonb) from public,anon,authenticated;
revoke all on function public_itinerary_private.api(text,jsonb) from public,anon,authenticated;
revoke select on public.public_itineraries from anon,authenticated;
notify pgrst,'reload schema';
commit;
