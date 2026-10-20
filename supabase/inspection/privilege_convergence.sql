-- CATALOG ONLY, READ ONLY. Do not execute without separate live-read approval.
-- No business/auth/account rows, definitions, credentials or connection details.
-- Save every result set privately BEFORE installation; ACLs are recovery evidence,
-- not a ready-to-run inverse migration. Role names are catalog metadata only.
begin transaction isolation level repeatable read read only;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Database ownership contributes implicit pg_database_owner privileges; role
-- memberships alone do not prove an equivalent installer. No database name.
select current_user as operator,session_user as session_operator,
  pg_catalog.pg_get_userbyid(d.datdba) as database_owner,
  d.datdba=(select oid from pg_catalog.pg_roles where rolname=current_user) as operator_is_database_owner,
  pg_catalog.pg_has_role(current_user,'pg_database_owner','USAGE') as database_owner_usage,
  case when current_setting('server_version_num')::integer >= 160000
    then pg_catalog.pg_has_role(current_user,'pg_database_owner','SET')
    else pg_catalog.pg_has_role(current_user,'pg_database_owner','MEMBER') end as database_owner_set,
  pg_catalog.has_schema_privilege(current_user,'public','USAGE') as public_usage,
  pg_catalog.has_schema_privilege(current_user,'public','CREATE') as public_create
from pg_catalog.pg_database d where d.datname=current_database();

-- Exact raw ACLs (NULL vs explicit), identity, owner; include public schema ACL
-- for diagnosis only. The migration NEVER revokes schema-wide privileges.
with objects as (
  select 'table'::text as kind, c.oid, c.oid::regclass::text as identity,
    c.relowner as owner_oid, c.relacl as acl, 'r'::"char" as acl_kind
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
    ('regions','labels','places','place_regions','place_labels','trips',
     'itinerary_items','route_maps','route_map_places','user_roles')
  union all
  select 'function',p.oid,p.oid::regprocedure::text,p.proowner,p.proacl,'f'::"char"
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.oid in (
    select pg_catalog.to_regprocedure(signature) from (values
      ('public.app_backup_preview_clear()'),('public.app_backup_apply_clear(text)'),
      ('public.app_backup_account_counts(uuid)'),('public.app_backup_has_shared_trip(uuid)'),
      ('public.app_backup_account_signature(uuid)'),('public.app_backup_assert_payload(jsonb)'),
      ('public.app_backup_preview_replace(jsonb)'),('public.app_backup_apply_replace(jsonb,text)'),
      ('public.can_manage_trip_acl(uuid)'),('public.assign_private_record_owner()'),
      ('public.assign_route_map_record_owner()')) expected(signature))
  union all
  select 'schema',oid,nspname,nspowner,nspacl,'n'::"char"
  from pg_catalog.pg_namespace where nspname='public'
)
select o.kind,o.oid,o.identity,o.owner_oid::regrole::text as owner,
  o.acl as raw_acl,o.acl is null as uses_builtin_acl,
  a.grantor::regrole::text as grantor,
  case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
  a.privilege_type,a.is_grantable,r.rolname as checked_role,
  case when a.grantee=0 then 'PUBLIC' when a.grantee=r.oid then 'direct'
    when pg_catalog.pg_has_role(r.oid,a.grantee,'USAGE') then 'inherited'
    when pg_catalog.pg_has_role(r.oid,a.grantee,'MEMBER') then 'membership / SET ROLE review'
    else 'other / platform' end as source
from objects o
left join lateral pg_catalog.aclexplode(coalesce(o.acl,pg_catalog.acldefault(o.acl_kind,o.owner_oid))) a on true
cross join pg_catalog.pg_roles r
where r.rolname in ('anon','authenticated','service_role')
order by o.kind,o.identity,r.rolname,grantee,a.privilege_type,grantor;

-- Column-level ACLs can grant access even when a table-level ACL does not.
select c.oid::regclass::text as identity,att.attname,att.attacl as raw_acl,
  a.grantor::regrole::text as grantor,
  case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
  a.privilege_type,a.is_grantable
from pg_catalog.pg_attribute att join pg_catalog.pg_class c on c.oid=att.attrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
left join lateral pg_catalog.aclexplode(att.attacl) a on true
where n.nspname='public' and c.relname in
  ('regions','labels','places','place_regions','place_labels','trips',
   'itinerary_items','route_maps','route_map_places','user_roles')
  and att.attnum>0 and not att.attisdropped and att.attacl is not null
order by identity,att.attnum,grantee,a.privilege_type;

-- Full membership edges (including platform roles), without account content.
-- to_jsonb preserves version-specific inherit/set options without assuming PG17.
select parent.rolname as granted_role,child.rolname as member,
  grantor.rolname as grantor,m.admin_option,
  to_jsonb(m)->'inherit_option' as inherit_option,
  to_jsonb(m)->'set_option' as set_option
from pg_catalog.pg_auth_members m
join pg_catalog.pg_roles parent on parent.oid=m.roleid
join pg_catalog.pg_roles child on child.oid=m.member
join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
order by granted_role,member,grantor;
select r.rolname,r.rolinherit,r.rolsuper,r.rolbypassrls,
  parent.rolname as reachable_role,
  pg_catalog.pg_has_role(r.oid,parent.oid,'USAGE') as inherited_now,
  pg_catalog.pg_has_role(r.oid,parent.oid,'MEMBER') as member
from pg_catalog.pg_roles r cross join pg_catalog.pg_roles parent
where r.rolname in ('anon','authenticated','service_role')
  and (r.oid=parent.oid or pg_catalog.pg_has_role(r.oid,parent.oid,'MEMBER'))
order by r.rolname,parent.rolname;

-- Exact creator/global/schema/grantee/privilege/GRANTOR sources, not guesses.
-- Show all schemas to avoid mistaking a schema-local grant for a global one.
select d.oid,d.defaclrole::regrole::text as creator,
  case when d.defaclnamespace=0 then '<global>' else n.nspname end as schema,
  d.defaclobjtype,d.defaclacl as raw_acl,
  a.grantor::regrole::text as grantor,
  case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
  a.privilege_type,a.is_grantable,r.rolname as checked_role,
  (a.grantee=0 or pg_catalog.pg_has_role(r.oid,a.grantee,'USAGE')) as effective_source,
  (a.grantee=0 or pg_catalog.pg_has_role(r.oid,a.grantee,'MEMBER')) as membership_source,
  (d.defaclnamespace=0 or n.nspname='public') as relevant_to_gate
from pg_catalog.pg_default_acl d
left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
cross join lateral pg_catalog.aclexplode(d.defaclacl) a
cross join pg_catalog.pg_roles r
where r.rolname in ('anon','authenticated','service_role')
order by creator,schema,d.defaclobjtype,grantee,a.privilege_type,r.rolname;

-- Effective object access, including owner/PUBLIC/inheritance; no row access.
select c.oid::regclass::text as identity,r.rolname,p.privilege,
  pg_catalog.has_table_privilege(r.oid,c.oid,p.privilege) as effective,
  pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT') as any_column_select,
  pg_catalog.has_any_column_privilege(r.oid,c.oid,'REFERENCES') as any_column_references
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
cross join pg_catalog.pg_roles r
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
where n.nspname='public' and c.relname in
  ('regions','labels','places','place_regions','place_labels','trips',
   'itinerary_items','route_maps','route_map_places','user_roles')
  and r.rolname in ('anon','authenticated','service_role')
order by identity,r.rolname,p.privilege;
select p.oid::regprocedure::text as identity,r.rolname,
  pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') as effective_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
cross join pg_catalog.pg_roles r
where n.nspname='public' and p.proname in
  ('app_backup_preview_clear','app_backup_apply_clear','app_backup_account_counts',
   'app_backup_has_shared_trip','app_backup_account_signature','app_backup_assert_payload',
   'app_backup_preview_replace','app_backup_apply_replace','can_manage_trip_acl',
   'assign_private_record_owner','assign_route_map_record_owner')
  and r.rolname in ('anon','authenticated','service_role')
order by identity,r.rolname;
select n.nspname,r.rolname,
  pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE') as effective_usage,
  pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE') as effective_create
from pg_catalog.pg_namespace n cross join pg_catalog.pg_roles r
where n.nspname='public' and r.rolname in ('anon','authenticated','service_role')
order by r.rolname;
commit;