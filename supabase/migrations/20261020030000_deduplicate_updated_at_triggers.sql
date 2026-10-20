-- Incremental catalog-only repair. Evidence: before/after-install catalog in
-- private convergence-live-install-qD4Kpw (2026-10-20), not business rows.
-- Only the five captured legacy triggers may be dropped. Keep BOTH functions,
-- all replacement/validation triggers, ACLs, platform defaults and data intact.
-- The two exact bodies assign transaction-stable now() and return NEW; neither
-- has side effects. No whitespace/body normalization or inferred equivalence.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local search_path = pg_catalog;
select pg_catalog.pg_advisory_xact_lock(741293, 1);

-- Same global-lock-before-table-lock order as application writes. Prevent
-- trigger/table DDL and writes while validating the whole five-table prestate.
lock table public.itinerary_items, public.labels, public.places,
  public.regions, public.trips in share row exclusive mode;

do $migration$
declare
  tables constant text[] := array['itinerary_items','labels','places','regions','trips'];
  table_name text;
  function_name text;
  trigger_name text;
  expected_definition text;
  function_oid oid;
  table_oid oid;
  legacy_count integer;
  functions_before jsonb;
  defaults_before jsonb;
  retained_before jsonb;
  observed jsonb;
  expected_set constant text := $definition$CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
$definition$;
  expected_touch constant text := $definition$CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin new.updated_at:=now(); return new; end; $function$
$definition$;
begin
  -- Snapshot functions BEFORE their guards, so drift between validation and
  -- removal also aborts at the postcheck. Installation still requires a DDL
  -- freeze: this advisory lock coordinates application writers, not arbitrary
  -- external ALTER FUNCTION sessions.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]'::jsonb)
    into functions_before from pg_catalog.pg_proc p
    where p.oid in (pg_catalog.to_regprocedure('public.set_updated_at()'),
      pg_catalog.to_regprocedure('public.touch_updated_at()'));
  select count(*) into legacy_count
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    where c.relnamespace='public'::regnamespace and c.relname=any(tables)
      and t.tgname=c.relname || '_touch_updated_at';
  if legacy_count not in (0,5) then
    raise exception 'Timestamp convergence blocked: partial legacy inventory';
  end if;

  foreach function_name in array array['set_updated_at','touch_updated_at'] loop
    function_oid := pg_catalog.to_regprocedure(format('public.%I()',function_name));
    -- A clean repository baseline has no touch function and no old triggers.
    -- Never synthesize a historical function or require one for that baseline.
    if function_oid is null and function_name='touch_updated_at' and legacy_count=0 then
      continue;
    end if;
    expected_definition := case function_name
      when 'set_updated_at' then expected_set else expected_touch end;
    if function_oid is null or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid=function_oid and p.proowner='postgres'::regrole
        and p.prokind='f' and p.prorettype='trigger'::regtype
        and not p.prosecdef and not p.proretset and p.pronargs=0
        and p.prosupport=0 and p.provariadic=0
        and p.proallargtypes is null and p.proargmodes is null and p.proargnames is null
        and p.proconfig is not distinct from case function_name
          when 'touch_updated_at' then array['search_path=""']::text[] else null::text[] end
        and pg_catalog.pg_get_functiondef(p.oid)=expected_definition
    ) then
      raise exception 'Timestamp convergence blocked: function drift (%)', function_name;
    end if;
  end loop;

  -- Validate ALL targets before dropping ANY. Strict all-five-or-none avoids
  -- accidentally accepting an unexplained partial historical installation.
  foreach table_name in array tables loop
    table_oid := pg_catalog.to_regclass(format('public.%I',table_name));
    if not exists (select 1 from pg_catalog.pg_class c where c.oid=table_oid
        and c.relkind='r' and not c.relispartition and c.relowner='postgres'::regrole) then
      raise exception 'Timestamp convergence blocked: table owner/shape drift (%)', table_name;
    end if;
    foreach function_name in array array['set_updated_at','touch_updated_at'] loop
      if function_name='touch_updated_at' and legacy_count=0 then continue; end if;
      trigger_name := case function_name when 'set_updated_at'
        then 'set_updated_at_' || table_name else table_name || '_touch_updated_at' end;
      expected_definition := format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',
        trigger_name,table_name,function_name);
      if not exists (
        select 1 from pg_catalog.pg_trigger t
        where t.tgrelid=table_oid and t.tgname=trigger_name
          and t.tgfoid=pg_catalog.to_regprocedure(format('public.%I()',function_name))
          and t.tgtype=19 and t.tgenabled='O' and not t.tgisinternal
          and t.tgparentid=0 and t.tgconstraint=0 and t.tgconstrrelid=0 and t.tgconstrindid=0
          and not t.tgdeferrable and not t.tginitdeferred
          and t.tgnargs=0 and t.tgargs=''::bytea and t.tgattr=''::int2vector
          and t.tgqual is null and t.tgoldtable is null and t.tgnewtable is null
          and pg_catalog.pg_get_triggerdef(t.oid,true)=expected_definition
      ) then
        raise exception 'Timestamp convergence blocked: trigger drift (%)', trigger_name;
      end if;
    end loop;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]'::jsonb)
    into defaults_before from pg_catalog.pg_default_acl d;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.oid),'[]'::jsonb)
    into retained_before from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    where c.relnamespace='public'::regnamespace and c.relname=any(tables)
      and t.tgname<>c.relname || '_touch_updated_at';

  if legacy_count=5 then
    foreach table_name in array tables loop
      execute format('drop trigger %I on public.%I',table_name || '_touch_updated_at',table_name);
    end loop;
  end if;

  if exists (select 1 from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid=t.tgrelid
      where c.relnamespace='public'::regnamespace and c.relname=any(tables)
        and t.tgname=c.relname || '_touch_updated_at') then
    raise exception 'Timestamp convergence blocked: legacy poststate';
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.oid),'[]'::jsonb)
    into observed from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    where c.relnamespace='public'::regnamespace and c.relname=any(tables);
  if observed is distinct from retained_before then
    raise exception 'Timestamp convergence blocked: retained trigger changed';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]'::jsonb)
    into observed from pg_catalog.pg_proc p
    where p.oid in (pg_catalog.to_regprocedure('public.set_updated_at()'),
      pg_catalog.to_regprocedure('public.touch_updated_at()'));
  if observed is distinct from functions_before then
    raise exception 'Timestamp convergence blocked: function changed';
  end if;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.oid),'[]'::jsonb)
    into observed from pg_catalog.pg_default_acl d;
  if observed is distinct from defaults_before then
    raise exception 'Timestamp convergence blocked: default ACL changed';
  end if;
end;
$migration$;
commit;