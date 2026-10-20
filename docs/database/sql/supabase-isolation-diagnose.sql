-- Read-only diagnostic: run in Supabase SQL Editor as postgres.
-- Returns role assignments, actual data owners and active access policies.
select jsonb_pretty(jsonb_build_object(
  'accounts', (select jsonb_agg(to_jsonb(x)) from (
    select u.email, u.id, r.role from auth.users u
    left join public.user_roles r on r.user_id = u.id
    where u.email ilike '%1991%' or u.email ilike '%8093%'
  ) x),
  'data_owners', (select jsonb_agg(to_jsonb(x)) from (
    select 'regions' as entity, u.email as owner_email, count(*) as records from public.regions d left join auth.users u on u.id=d.owner_uid group by u.email
    union all select 'places', u.email, count(*) from public.places d left join auth.users u on u.id=d.owner_uid group by u.email
    union all select 'labels', u.email, count(*) from public.labels d left join auth.users u on u.id=d.owner_uid group by u.email
    union all select 'trips', u.email, count(*) from public.trips d left join auth.users u on u.id=d.owner_uid group by u.email
  ) x),
  'rls_enabled', (select jsonb_agg(to_jsonb(x)) from (
    select relname as entity, relrowsecurity as enabled from pg_class
    where oid in ('public.regions'::regclass,'public.places'::regclass,'public.labels'::regclass,'public.trips'::regclass,'public.itinerary_items'::regclass)
  ) x),
  'policies', (select jsonb_agg(to_jsonb(x)) from (
    select tablename, policyname, roles, cmd, qual, with_check from pg_policies
    where schemaname='public' and tablename in ('regions','places','labels','trips','itinerary_items','place_regions','place_labels')
  ) x),
  'role_functions', (select jsonb_agg(to_jsonb(x)) from (
    select p.proname, pg_get_functiondef(p.oid) as definition from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('app_current_role','app_is_member','app_is_admin')
  ) x)
)) as diagnostic;
