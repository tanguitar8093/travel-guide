-- Narrowed scope: clear only postgres public client defaults. Retain the EXACT
-- supabase_admin public matrix (or no platform rows), never a partial matrix.
-- Client cells: self grantor, direct anon/authenticated, no grant options.
-- Captured platform nonclient/options and known outside-schema inventory stay raw-exact.
-- No role creation, ownership change, global revoke, or schema-wide object revoke.
-- Capture inspection/privilege_convergence.sql privately BEFORE installation.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(741293, 1);

do $$
declare
  source record;
  creator record;
  original_role text := current_user;
  can_use boolean;
  can_set boolean;
  version integer := current_setting('server_version_num')::integer;
  protected_before jsonb;
  protected_after jsonb;
  outside_before jsonb;
  outside_after jsonb;
  platform_before jsonb;
  platform_after jsonb;
  platform_count integer;
  platform_distinct_count integer;
begin
  select coalesce(jsonb_agg(to_jsonb(d) order by d.oid), '[]'::jsonb)
    into platform_before from pg_catalog.pg_default_acl d
    where d.defaclrole = pg_catalog.to_regrole('supabase_admin');
  -- Inspect raw rows BEFORE aclexplode: empty/multidimensional ACL arrays
  -- cannot be decoded, and out-of-scope platform rows must fail our guard.
  if exists (select 1 from pg_catalog.pg_default_acl d
      where (d.defaclrole = pg_catalog.to_regrole('supabase_admin')
          and coalesce((select nspname from pg_catalog.pg_namespace where oid=d.defaclnamespace),'')
            not in ('public','extensions','graphql','graphql_public','realtime'))
        or ((d.defaclrole = pg_catalog.to_regrole('supabase_admin')
            or d.defaclnamespace in (0, 'public'::regnamespace))
          and (pg_catalog.array_ndims(d.defaclacl) is distinct from 1
            or pg_catalog.cardinality(d.defaclacl) = 0))) then
    raise exception 'Default privilege convergence blocked: unapproved default ACL raw row' using errcode = '42501';
  end if;
  -- Validate ALL relevant sources before any change. In particular, global
  -- function PUBLIC entries are not an approved repair, even if equivalent to
  -- built-in defaults. NULL built-in function ACLs are not catalog rows here.
  for source in
    select d.defaclrole, r.rolname as creator, d.defaclnamespace,
      n.nspname, d.defaclobjtype, a.*, client.rolname as client
    from pg_catalog.pg_default_acl d
    join pg_catalog.pg_roles r on r.oid = d.defaclrole
    left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    left join pg_catalog.pg_roles client on client.oid = a.grantee
    where r.rolname = 'supabase_admin' or ((d.defaclnamespace = 0 or n.nspname = 'public')
      and (a.grantee = 0 or exists (
        select 1 from pg_catalog.pg_roles c
        where c.rolname in ('anon','authenticated')
          and pg_catalog.pg_has_role(c.oid, a.grantee, 'MEMBER')
      )))
  loop
    -- Known retained inventory is not client cleanup. Reject reachable parent
    -- roles; preserve original nonclient grant options rather than normalizing.
    if source.creator = 'supabase_admin' and source.grantor = source.defaclrole
      and ((source.nspname in ('public','graphql','graphql_public') and source.client in ('postgres','service_role'))
        or (source.nspname = 'extensions' and source.client = 'postgres')
        or (source.nspname = 'realtime' and source.client in ('postgres','dashboard_user')))
      and not exists (select 1 from pg_catalog.pg_roles c where c.rolname in ('anon','authenticated')
        and pg_catalog.pg_has_role(c.oid,source.grantee,'MEMBER'))
      and ((source.defaclobjtype = 'r' and source.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
        or (source.defaclobjtype = 'r' and source.privilege_type = 'MAINTAIN' and version >= 170000)
        or (source.defaclobjtype = 'S' and source.privilege_type in ('USAGE','SELECT','UPDATE'))
        or (source.defaclobjtype = 'f' and source.privilege_type = 'EXECUTE')) then continue; end if;
    if source.creator not in ('postgres','supabase_admin')
      or (source.nspname is distinct from 'public' and not
        (source.creator = 'supabase_admin' and source.nspname in ('graphql','graphql_public')))
      or source.client is null or source.client not in ('anon','authenticated')
      or source.grantor <> source.defaclrole or source.is_grantable
      or not (
        (source.defaclobjtype = 'r' and source.privilege_type in
          ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
        or (source.defaclobjtype = 'r' and source.privilege_type = 'MAINTAIN' and version >= 170000)
        or (source.defaclobjtype = 'S' and source.privilege_type in ('USAGE','SELECT','UPDATE'))
        or (source.defaclobjtype = 'f' and source.privilege_type = 'EXECUTE')
      ) then
      raise exception 'Default privilege convergence blocked: unapproved default ACL (creator %, namespace %, type %, grantee %, privilege %, grantor %, grantable %)',
        source.creator, source.defaclnamespace, source.defaclobjtype,
        source.grantee, source.privilege_type, source.grantor, source.is_grantable
        using errcode = '42501';
    end if;
  end loop;

  -- Presence means the entire reviewed matrix: 24 cells on PG17+, 22 before.
  -- Empty standalone baselines are accepted; missing/extra groups fail closed.
  select count(*), count(distinct (d.defaclobjtype,a.grantee,a.privilege_type))
    into platform_count, platform_distinct_count
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where d.defaclrole = pg_catalog.to_regrole('supabase_admin')
      and d.defaclnamespace = 'public'::regnamespace
      and a.grantee in ('anon'::regrole,'authenticated'::regrole);
  if exists (select 1 from pg_catalog.pg_default_acl d
      where d.defaclrole = pg_catalog.to_regrole('supabase_admin')
        and coalesce((select nspname from pg_catalog.pg_namespace where oid=d.defaclnamespace),'')
          not in ('public','extensions','graphql','graphql_public','realtime'))
    or platform_distinct_count <> platform_count
    or (platform_count <> case when version >= 170000 then 24 else 22 end
      and exists (select 1 from pg_catalog.pg_default_acl d
        where d.defaclrole = pg_catalog.to_regrole('supabase_admin')
          and d.defaclnamespace = 'public'::regnamespace))
    or exists (select 1 from pg_catalog.pg_default_acl d
      where d.defaclrole = pg_catalog.to_regrole('supabase_admin')
        and d.defaclnamespace = 'public'::regnamespace
      group by d.defaclrole having count(*) <> 3) then
    raise exception 'Default privilege convergence blocked: unapproved default ACL partial platform matrix' using errcode = '42501';
  end if;
  -- Every retained grantee has the complete known r/S/f inventory. Public
  -- nonclient groups may be absent on standalone fixtures, never arbitrary extras.
  if exists (select 1 from pg_catalog.pg_default_acl d
      cross join lateral pg_catalog.aclexplode(d.defaclacl) a
      where d.defaclrole=pg_catalog.to_regrole('supabase_admin')
      group by d.defaclnamespace,a.grantee
      having count(*) <> case when version >= 170000 then 12 else 11 end
        or count(distinct (d.defaclobjtype,a.privilege_type)) <> count(*))
    or exists (select 1 from pg_catalog.pg_default_acl d
      join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
      cross join lateral pg_catalog.aclexplode(d.defaclacl) a
      where d.defaclrole=pg_catalog.to_regrole('supabase_admin') and n.nspname <> 'public'
      group by n.nspname having count(*) <> (case n.nspname
        when 'extensions' then 1 when 'realtime' then 2 else 4 end) *
        (case when version >= 170000 then 12 else 11 end)) then
    raise exception 'Default privilege convergence blocked: unapproved default ACL retained inventory matrix' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.defaclrole,s.defaclnamespace,
    s.defaclobjtype,s.grantor,s.grantee,s.privilege_type), '[]'::jsonb)
  into protected_before from (
    select d.defaclrole,d.defaclnamespace,d.defaclobjtype,a.*
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where not exists (select 1 from pg_catalog.pg_roles c
      where c.rolname in ('anon','authenticated') and c.oid = a.grantee)
  ) s;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.oid), '[]'::jsonb)
    into outside_before from pg_catalog.pg_default_acl d
    where d.defaclnamespace <> 'public'::regnamespace;

  -- Only creators with present approved drift need authorization. An absent
  -- Supabase platform role (standalone baseline) must not be created or assumed.
  for creator in
    select distinct r.oid,r.rolname
    from pg_catalog.pg_default_acl d
    join pg_catalog.pg_roles r on r.oid = d.defaclrole
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    join pg_catalog.pg_roles c on c.oid = a.grantee
    where d.defaclnamespace = 'public'::regnamespace
      and r.rolname = 'postgres'
      and c.rolname in ('anon','authenticated')
    order by r.rolname
  loop
    can_use := pg_catalog.pg_has_role(current_user, creator.oid, 'USAGE');
    if version >= 160000 then
      can_set := pg_catalog.pg_has_role(current_user, creator.oid, 'SET');
    else
      -- Pre-16 memberships have no separate set_option.
      can_set := pg_catalog.pg_has_role(current_user, creator.oid, 'MEMBER');
    end if;
    if not can_use and not can_set then
      raise exception 'Default privilege convergence blocked: creator % requires authorized USAGE or SET; no privilege escalation is attempted',
        creator.rolname using errcode = '42501';
    end if;
    if not can_use then
      execute format('set local role %I', creator.rolname);
    end if;

    -- Explicit seven portable privileges, plus PG17+ MAINTAIN. Never ALL:
    -- future/unknown privileges must fail review rather than be silently removed.
    execute format('alter default privileges for role %I in schema public revoke select,insert,update,delete,truncate,references,trigger on tables from anon,authenticated', creator.rolname);
    if version >= 170000 then
      execute format('alter default privileges for role %I in schema public revoke maintain on tables from anon,authenticated', creator.rolname);
    end if;
    execute format('alter default privileges for role %I in schema public revoke usage,select,update on sequences from anon,authenticated', creator.rolname);
    execute format('alter default privileges for role %I in schema public revoke execute on functions from anon,authenticated', creator.rolname);
    if not can_use then
      execute format('set local role %I', original_role);
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_default_acl d
    left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where (d.defaclnamespace = 0 or n.nspname = 'public')
      and d.defaclrole is distinct from pg_catalog.to_regrole('supabase_admin')
      and (a.grantee = 0 or exists (
        select 1 from pg_catalog.pg_roles c
        where c.rolname in ('anon','authenticated')
          and pg_catalog.pg_has_role(c.oid,a.grantee,'MEMBER')
      ))
  ) then
    raise exception 'Default privilege convergence blocked: remaining effective default client source' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.defaclrole,s.defaclnamespace,
    s.defaclobjtype,s.grantor,s.grantee,s.privilege_type), '[]'::jsonb)
  into protected_after from (
    select d.defaclrole,d.defaclnamespace,d.defaclobjtype,a.*
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    where not exists (select 1 from pg_catalog.pg_roles c
      where c.rolname in ('anon','authenticated') and c.oid = a.grantee)
  ) s;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.oid), '[]'::jsonb)
    into outside_after from pg_catalog.pg_default_acl d
    where d.defaclnamespace <> 'public'::regnamespace;
  if protected_before is distinct from protected_after or outside_before is distinct from outside_after then
    raise exception 'Default privilege convergence blocked: protected nonclient/global/other-schema ACL changed' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.oid), '[]'::jsonb)
    into platform_after from pg_catalog.pg_default_acl d
    where d.defaclrole = pg_catalog.to_regrole('supabase_admin');
  if platform_before is distinct from platform_after then
    raise exception 'Default privilege convergence blocked: retained platform raw/semantic ACL changed' using errcode = '42501';
  end if;
  -- Platform-created future public objects retain client defaults and require
  -- explicit per-object ACL review. No platform USAGE/SET is required or added.
  -- Built-in function PUBLIC EXECUTE remains expected. Individual function
  -- migrations must explicitly REVOKE it; this patch never claims otherwise.
end;
$$;
commit;