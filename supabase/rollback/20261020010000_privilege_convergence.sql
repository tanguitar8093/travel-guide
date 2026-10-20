-- RECOVERY TEMPLATE, NOT AN AUTOMATIC REVERSE MIGRATION.
-- Permission tightening must not be blindly undone with broad/insecure GRANTs.
-- Before installation, privately capture ALL result sets of the catalog-only
-- inspection/privilege_convergence.sql, including raw ACL NULL vs explicit ACL,
-- object identity/owner, grantor, grantee, grant option and role memberships.
-- Keep the capture with the approved installation record, not in source/chat.
-- Rehearse an exact ACL restoration in an isolated restored database first.
--
-- Recovery requires separate approval of the specific insecure permissions
-- being restored. Substitute the guard below with reviewed, object-specific
-- GRANT/REVOKE statements derived from the captured PREINSTALL ACL (not today's
-- catalog and not an assumed Supabase default). Preserve original grantors via
-- authorized SET LOCAL ROLE where necessary, including WITH GRANT OPTION.
-- Compare raw and exploded ACLs, owners and effective checks with the capture;
-- account for legitimate post-install ACL changes before applying a recovery.
-- Do not replay baseline, change owners/memberships or restore all business data.
-- If default ACLs were patched separately, recover them only from their own
-- creator/schema-specific preinstall capture and separately approved script.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(741293, 1);
do $$
begin
  raise exception 'Recovery blocked: substitute separately approved exact preinstall ACL statements and rehearse before use';
end;
$$;
commit;