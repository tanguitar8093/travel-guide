-- LEGACY collaboration test: incompatible with phase-one private isolation.
-- Use src/database/owner-isolation.test.ts for the active permission contract.
-- Re-runnable RLS smoke test for trips/itinerary ACL.
-- Run with:
--   supabase db query --linked --file docs/supabase-rls-smoke-test.sql

begin;

-- Cleanup any previous fixtures first.
delete from public.itinerary_items where trip_id = '44444444-4444-4444-8444-444444444444';
delete from public.trips where id = '44444444-4444-4444-8444-444444444444';
delete from public.regions where id = '33333333-3333-4333-8333-333333333333';
delete from auth.users where id in (
	'11111111-1111-4111-8111-111111111111',
	'22222222-2222-4222-8222-222222222222',
	'55555555-5555-4555-8555-555555555555'
);

-- Seed deterministic auth users required by trips.owner_uid foreign key.
insert into auth.users (
	id,
	aud,
	role,
	email,
	email_confirmed_at,
	created_at,
	updated_at,
	raw_app_meta_data,
	raw_user_meta_data
)
values
	(
		'11111111-1111-4111-8111-111111111111',
		'authenticated',
		'authenticated',
		'owner-smoke@example.com',
		now(),
		now(),
		now(),
		'{}'::jsonb,
		'{}'::jsonb
	),
	(
		'22222222-2222-4222-8222-222222222222',
		'authenticated',
		'authenticated',
		'collab-smoke@example.com',
		now(),
		now(),
		now(),
		'{}'::jsonb,
		'{}'::jsonb
	),
	(
		'55555555-5555-4555-8555-555555555555',
		'authenticated',
		'authenticated',
		'outsider-smoke@example.com',
		now(),
		now(),
		now(),
		'{}'::jsonb,
		'{}'::jsonb
	);

commit;

-- Owner flow: create region/trip, then share with collaborator.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

insert into public.regions (id, name, google_place_id, zoom)
values ('33333333-3333-4333-8333-333333333333', 'Smoke Region', 'smoke-region-place-id', 10);

insert into public.trips (id, region_id, name, start_date, end_date)
values (
	'44444444-4444-4444-8444-444444444444',
	'33333333-3333-4333-8333-333333333333',
	'Smoke Trip',
	'2026-12-01',
	'2026-12-03'
);

update public.trips
set edit_mode = 'shared',
		editor_uids = array['22222222-2222-4222-8222-222222222222'::uuid]
where id = '44444444-4444-4444-8444-444444444444';

commit;

-- Assert owner defaults and ACL values.
do $$
declare
	v_owner uuid;
	v_mode text;
	v_editors uuid[];
begin
	select owner_uid, edit_mode, editor_uids
	into v_owner, v_mode, v_editors
	from public.trips
	where id = '44444444-4444-4444-8444-444444444444';

	if v_owner <> '11111111-1111-4111-8111-111111111111'::uuid then
		raise exception 'Smoke test failed: owner_uid mismatch (%).', v_owner;
	end if;

	if v_mode <> 'shared' then
		raise exception 'Smoke test failed: edit_mode mismatch (%).', v_mode;
	end if;

	if cardinality(v_editors) <> 1
		 or v_editors[1] <> '22222222-2222-4222-8222-222222222222'::uuid then
		raise exception 'Smoke test failed: editor_uids mismatch (%).', v_editors;
	end if;
end;
$$;

-- Collaborator flow: update should succeed with exactly one row.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $$
declare
	v_rows integer;
begin
	update public.trips
	set name = 'Smoke Trip Updated by Collaborator'
	where id = '44444444-4444-4444-8444-444444444444';

	get diagnostics v_rows = row_count;

	if v_rows <> 1 then
		raise exception 'Smoke test failed: collaborator update affected % rows.', v_rows;
	end if;
end;
$$;

commit;

-- Outsider flow: update should be denied by RLS and affect zero rows.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);

do $$
declare
	v_rows integer;
begin
	update public.trips
	set name = 'Smoke Trip Updated by Outsider'
	where id = '44444444-4444-4444-8444-444444444444';

	get diagnostics v_rows = row_count;

	if v_rows <> 0 then
		raise exception 'Smoke test failed: outsider update affected % rows.', v_rows;
	end if;
end;
$$;

commit;

-- Assert collaborator change persisted.
do $$
declare
	v_name text;
begin
	select name into v_name
	from public.trips
	where id = '44444444-4444-4444-8444-444444444444';

	if v_name <> 'Smoke Trip Updated by Collaborator' then
		raise exception 'Smoke test failed: final trip name mismatch (%).', v_name;
	end if;
end;
$$;

-- Cleanup fixtures to keep database clean after successful run.
begin;
delete from public.itinerary_items where trip_id = '44444444-4444-4444-8444-444444444444';
delete from public.trips where id = '44444444-4444-4444-8444-444444444444';
delete from public.regions where id = '33333333-3333-4333-8333-333333333333';
delete from auth.users where id in (
	'11111111-1111-4111-8111-111111111111',
	'22222222-2222-4222-8222-222222222222',
	'55555555-5555-4555-8555-555555555555'
);
commit;

select 'RLS_SMOKE_TEST_PASS' as result;
