-- Read-only private evidence; never a replacement for pg_dump.
begin transaction isolation level repeatable read read only;
\if :{?capture_snapshot}
set transaction snapshot :'capture_snapshot';
\endif
set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = pg_catalog;
with schemas as (
  select oid,nspname,nspowner::regrole::text as owner,nspacl::text as raw_acl
  from pg_namespace where nspname in ('public','sync_private','collaboration_private','auth')
), objects as (
  select 'table' as kind,c.oid,format('%I.%I',n.nspname,c.relname) as identity,
    c.relowner as owner_oid,c.relacl as acl,'r'::"char" as acl_kind
  from pg_class c join schemas n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m')
  union all
  select 'function',p.oid,format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)),
    p.proowner,p.proacl,'f'::"char"
  from pg_proc p join schemas n on n.oid=p.pronamespace where p.prokind='f'
), cells as (
  select o.kind,o.identity,o.owner_oid::regrole::text as owner,
    a.grantor::regrole::text as grantor,
    case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
    a.privilege_type as privilege,a.is_grantable
  from objects o cross join lateral aclexplode(coalesce(o.acl,acldefault(o.acl_kind,o.owner_oid))) a
), defaults as (
  select d.oid,d.defaclrole::regrole::text as creator,
    coalesce(n.nspname,'<global>') as schema,d.defaclobjtype as type,d.defaclacl::text as raw_acl,
    a.grantor::regrole::text as grantor,
    case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
    a.privilege_type as privilege,a.is_grantable
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
)
select json_build_object(
  'kind','catalog','captured_at',transaction_timestamp(),'snapshot',pg_current_snapshot()::text,
  'convergence_scope','postgres-defaults-existing-app-acl-reorder-retain-exact-platform-v3',
  'server_version_num',current_setting('server_version_num'),
  'database',(select json_build_object('owner',datdba::regrole::text,
    'operator_is_owner',datdba=(select oid from pg_roles where rolname=current_user),
    'allow_connections',datallowconn,'connection_limit',datconnlimit,'raw_acl',datacl::text,
    'acl',(select coalesce(jsonb_agg(jsonb_build_object(
      'grantor',a.grantor::regrole::text,
      'grantee',case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,
      'privilege',a.privilege_type,'is_grantable',a.is_grantable)
      order by a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type),'[]'::jsonb)
      from aclexplode(coalesce(datacl,acldefault('d',datdba))) a))
    from pg_database where datname=current_database()),
  'operator',json_build_object('role',current_user,'session_role',session_user,
    'superuser',(select rolsuper from pg_roles where rolname=current_user),
    'bypassrls',(select rolbypassrls from pg_roles where rolname=current_user),
    'postgres_usage',pg_has_role(current_user,'postgres','USAGE'),
    'postgres_set',pg_has_role(current_user,'postgres','SET'),
    'pg_database_owner_usage',pg_has_role(current_user,'pg_database_owner','USAGE'),
    'pg_database_owner_set',pg_has_role(current_user,'pg_database_owner','SET'),
    'public_create',has_schema_privilege(current_user,'public','CREATE'),
    'public_usage',has_schema_privilege(current_user,'public','USAGE'),
    'database_create',has_database_privilege(current_user,current_database(),'CREATE'),
    'database_connect',has_database_privilege(current_user,current_database(),'CONNECT'),
    'database_temporary',has_database_privilege(current_user,current_database(),'TEMPORARY'),
    'supabase_admin_usage',coalesce(pg_has_role(current_user,to_regrole('supabase_admin'),'USAGE'),false),
    'supabase_admin_set',coalesce(pg_has_role(current_user,to_regrole('supabase_admin'),'SET'),false)),
  'schemas',(select json_agg(s order by nspname) from schemas s),
  'objects',(select json_agg(json_build_object('kind',kind,'oid',oid,'identity',identity,
    'owner',owner_oid::regrole::text,'raw_acl',acl::text) order by kind,identity) from objects),
  'cells',(select json_agg(c order by kind,identity,grantor,grantee,privilege) from cells c),
  'defaults',(select coalesce(json_agg(d order by creator,schema,type,grantor,grantee,privilege),'[]'::json) from defaults d),
  'default_rows',(select coalesce(jsonb_agg(jsonb_build_object('creator',d.defaclrole::regrole::text,
    'schema',coalesce(n.nspname,'<global>'),'type',d.defaclobjtype,'raw_acl',d.defaclacl::text)
    order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb)
    from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace),
  'roles',(select json_agg(r order by rolname) from (select rolname,rolsuper,rolinherit,
    rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit from pg_roles) r),
  'memberships',(select coalesce(json_agg(m order by granted_role,member,grantor),'[]'::json) from (
    select p.rolname as granted_role,c.rolname as member,g.rolname as grantor,
      m.admin_option,m.inherit_option,m.set_option from pg_auth_members m
    join pg_roles p on p.oid=m.roleid join pg_roles c on c.oid=m.member
    join pg_roles g on g.oid=m.grantor) m),
  'functions',(select json_agg(json_build_object('identity',o.identity,'definition',pg_get_functiondef(p.oid),
    'source',p.prosrc,'owner',p.proowner::regrole::text,'security_definer',p.prosecdef,'config',p.proconfig)
    order by o.identity) from objects o join pg_proc p on p.oid=o.oid where o.kind='function'),
  'columns',(select json_agg(json_build_object('table',o.identity,'name',a.attname,'number',a.attnum,
    'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'raw_acl',a.attacl::text,
    'default',pg_get_expr(d.adbin,d.adrelid)) order by o.identity,a.attnum)
    from objects o join pg_attribute a on a.attrelid=o.oid
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where o.kind='table' and a.attnum>0 and not a.attisdropped),
  'constraints',(select json_agg(json_build_object('table',o.identity,'name',c.conname,
    'definition',pg_get_constraintdef(c.oid,true)) order by o.identity,c.conname)
    from objects o join pg_constraint c on c.conrelid=o.oid where o.kind='table'),
  'triggers',(select json_agg(json_build_object('table',o.identity,'name',t.tgname,
    'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) order by o.identity,t.tgname)
    from objects o join pg_trigger t on t.tgrelid=o.oid where o.kind='table' and not t.tgisinternal),
  'indexes',(select json_agg(i order by schemaname,tablename,indexname) from pg_indexes i
    where schemaname in (select nspname from schemas)),
  'policies',(select json_agg(p order by schemaname,tablename,policyname) from pg_policies p
    where schemaname in (select nspname from schemas)),
  'row_security',(select json_agg(json_build_object('table',o.identity,'enabled',c.relrowsecurity,
    'forced',c.relforcerowsecurity) order by o.identity) from objects o join pg_class c on c.oid=o.oid
    where o.kind='table')
)::jsonb::text;
-- Same repeatable-read snapshot for metadata and every full-row fingerprint.
select format('select json_build_object(''kind'',''fingerprint'',''table'',%L,''rows'',count(*),''md5'',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),''''))) from %I.%I t;',
  format('%I.%I',n.nspname,c.relname),n.nspname,c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','sync_private','collaboration_private','auth') and c.relkind in ('r','p')
order by n.nspname,c.relname
\gexec
commit;