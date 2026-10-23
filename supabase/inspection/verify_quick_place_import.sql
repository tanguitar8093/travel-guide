-- Exercises a real existing member within a transaction; all test writes roll back.
begin;
do $$
declare member_uid uuid;
begin
  select user_id into member_uid from public.user_roles where role in ('member','admin') order by user_id limit 1;
  if member_uid is null then raise exception 'No member available for transactional API verification'; end if;
  perform set_config('request.jwt.claim.sub',member_uid::text,true);
end;
$$;
set local role authenticated;
do $$
declare operation uuid := gen_random_uuid(); created jsonb; repeated jsonb; snapshot jsonb;
begin
  created := public.app_import_place('__TripMap_API_ROLLBACK_CHECK__',26.8999,128.3599,operation);
  if created->>'status'<>'created' then raise exception 'Expected a new transactional test place'; end if;
  repeated := public.app_import_place('__TripMap_API_ROLLBACK_CHECK__',26.8999,128.3599,operation);
  if repeated->>'status'<>'already_imported' then raise exception 'Retry was not idempotent'; end if;
  snapshot := public.app_sync_snapshot();
  if not exists(select 1 from jsonb_array_elements(snapshot->'records') r where r->>'id'=operation::text) then
    raise exception 'Imported place missing from existing sync';
  end if;
end;
$$;
rollback;
select not has_function_privilege('anon',
  'public.app_import_place(text,double precision,double precision,uuid,text)','EXECUTE') as anonymous_denied;
select not prosecdef as uses_caller_rls from pg_proc
  where oid='public.app_import_place(text,double precision,double precision,uuid,text)'::regprocedure;
select count(*)=0 as no_test_places_left from public.places where name='__TripMap_API_ROLLBACK_CHECK__';
