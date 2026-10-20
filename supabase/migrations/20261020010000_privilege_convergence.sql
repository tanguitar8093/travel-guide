-- Incremental A permission convergence. No baseline replay, data/role rewrite,
-- schema-wide revoke, default-ACL rewrite, or recursive platform-role revoke.
-- Before installation: capture inspection/privilege_convergence.sql privately,
-- approve exact catalog differences and rehearse recovery in isolation.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(741293, 1);

-- Defaults are creator-specific and global + per-schema ACLs are additive.
-- Without an approved creator-specific patch we must STOP, not claim success.
-- Conservatively reject even explicit PUBLIC function defaults (built-in NULL
-- function ACLs are not pg_default_acl rows). Review those sources separately.
do $$
declare source record;
begin
  for source in
    select d.defaclrole::regrole as creator,
      case when d.defaclnamespace = 0 then '<global>' else n.nspname end as scope,
      d.defaclobjtype, a.grantee, a.privilege_type, a.grantor::regrole as grantor
    from pg_catalog.pg_default_acl d
    left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where (d.defaclnamespace = 0 or n.nspname = 'public')
      and (a.grantee = 0 or exists (
        select 1 from pg_catalog.pg_roles r
        where r.rolname in ('anon', 'authenticated')
          and pg_catalog.pg_has_role(r.oid, a.grantee, 'MEMBER')
      ))
  loop
    raise exception 'Privilege convergence blocked: unapproved default ACL (creator %, scope %, type %, grantee %, privilege %, grantor %). Capture inventory and approve a creator-specific patch first.',
      source.creator, source.scope, source.defaclobjtype, source.grantee,
      source.privilege_type, source.grantor using errcode = '42501';
  end loop;
end;
$$;

-- Explicit known direct drift only. RESTRICT is intentional: dependent grants
-- require separate inventory/approval, never an implicit CASCADE.
revoke truncate, references, trigger on table
  public.regions, public.labels, public.places, public.place_regions,
  public.place_labels, public.trips, public.itinerary_items,
  public.route_maps, public.route_map_places, public.user_roles
  from authenticated restrict;
revoke select, insert, update, delete, truncate, references, trigger
  on table public.user_roles from anon restrict;

-- Baseline intentionally grants authenticated EXECUTE on ALL nine helpers,
-- including account counts/signature/has_shared_trip and assert_payload.
-- This migration preserves that API; redesigning helper access is separate work.
revoke execute on function
  public.app_backup_preview_clear(), public.app_backup_apply_clear(text),
  public.app_backup_account_counts(uuid), public.app_backup_has_shared_trip(uuid),
  public.app_backup_account_signature(uuid), public.app_backup_assert_payload(jsonb),
  public.app_backup_preview_replace(jsonb), public.app_backup_apply_replace(jsonb,text),
  public.can_manage_trip_acl(uuid)
  from anon restrict;
revoke execute on function public.assign_private_record_owner(),
  public.assign_route_map_record_owner() from anon, authenticated restrict;

-- Fail closed on unknown effective/PUBLIC/inherited/SET ROLE-capable grants.
-- Never repair those by revoking from arbitrary Supabase/platform parent roles.
do $$
declare
  target text;
  caller text;
  privilege text;
  object_id oid;
  allowed boolean;
begin
  foreach target in array array['regions','labels','places','place_regions',
    'place_labels','trips','itinerary_items','route_maps','route_map_places','user_roles'] loop
    object_id := ('public.' || target)::regclass;
    foreach caller in array array['anon','authenticated'] loop
      foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        allowed := caller = 'authenticated' and privilege in ('SELECT','INSERT','UPDATE','DELETE');
        if pg_catalog.has_table_privilege(caller, object_id, privilege) is distinct from allowed then
          raise exception 'Privilege convergence blocked: unexpected effective table ACL %.% %', target, caller, privilege using errcode = '42501';
        end if;
      end loop;
      if exists (
        select 1 from pg_catalog.pg_class c
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r',c.relowner))) a
        where c.oid = object_id
          and (a.grantee = 0 or pg_catalog.pg_has_role(caller, a.grantee, 'MEMBER'))
          and (caller = 'anon' or a.privilege_type not in ('SELECT','INSERT','UPDATE','DELETE') or a.is_grantable)
      ) or exists (
        select 1 from pg_catalog.pg_attribute c
        cross join lateral pg_catalog.aclexplode(c.attacl) a
        where c.attrelid = object_id and c.attnum > 0 and not c.attisdropped
          and (a.grantee = 0 or pg_catalog.pg_has_role(caller, a.grantee, 'MEMBER'))
          and (caller = 'anon' or a.privilege_type = 'REFERENCES' or a.is_grantable)
      ) then
        raise exception 'Privilege convergence blocked: unexpected table/column ACL source %.%', target, caller using errcode = '42501';
      end if;
    end loop;
  end loop;

  foreach target in array array['app_backup_preview_clear()','app_backup_apply_clear(text)',
    'app_backup_account_counts(uuid)','app_backup_has_shared_trip(uuid)',
    'app_backup_account_signature(uuid)','app_backup_assert_payload(jsonb)',
    'app_backup_preview_replace(jsonb)','app_backup_apply_replace(jsonb,text)',
    'can_manage_trip_acl(uuid)','assign_private_record_owner()','assign_route_map_record_owner()'] loop
    object_id := ('public.' || target)::regprocedure;
    foreach caller in array array['anon','authenticated'] loop
      allowed := caller = 'authenticated' and target not in ('assign_private_record_owner()','assign_route_map_record_owner()');
      if pg_catalog.has_function_privilege(caller, object_id, 'EXECUTE') is distinct from allowed
        or exists (
          select 1 from pg_catalog.pg_proc p
          cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
          where p.oid = object_id
            and (a.grantee = 0 or pg_catalog.pg_has_role(caller, a.grantee, 'MEMBER'))
            and (not allowed or a.is_grantable)
        ) then
        raise exception 'Privilege convergence blocked: unexpected function ACL source %.%', target, caller using errcode = '42501';
      end if;
    end loop;
  end loop;
end;
$$;
commit;