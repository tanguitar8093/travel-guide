-- GATED RECOVERY TEMPLATE, deliberately not an executable broad inverse.
-- The repair accepts missing/sparse defaults. Never GRANT the inventory's full
-- matrix on a clean baseline: that would introduce privileges never installed.
-- Capture fresh PREINSTALL raw pg_default_acl rows (including absent rows),
-- creator/schema/type, exploded grantor/grantee/privilege/grant options, role
-- memberships/options and server_version_num, privately with the install record.
-- Approved observed matrix (each grantor is its creator, NO grant options):
-- CHANGED creator postgres ONLY; schema public; direct anon/authenticated;
-- tables SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN;
-- sequences USAGE SELECT UPDATE; functions EXECUTE. Restore only captured cells.
-- supabase_admin defaults are intentionally retained, not revoked/restored.
-- Guard their complete raw and semantic state before/after; never require SET
-- supabase_admin or emit ALTER DEFAULT PRIVILEGES for this untouched creator.
-- A fresh capture must include DATABASE owner and effective pg_database_owner /
-- public schema rights. Old archives without these are not valid evidence.
-- The current contract additionally captures database ACL/connection attributes and
-- effective database rights; frozen migration AND rollback hashes must match.
-- Reject platform rows outside public, including empty/global catalog rows;
-- require the exact complete platform matrix or no platform rows at all.
--
-- Replace the guard ONLY with a separately approved, rehearsed script that:
-- 1. Asserts the captured creator OIDs/names, public namespace, role authority,
--    server version, exact postinstall ACLs and absence of unreviewed later drift.
--    Assert the preinstall matrix is self-granted/direct/non-grantable and is a
--    SUBSET of the matrix above. Missing rows mean NO recovery GRANT.
-- 2. Uses the actual captured postgres operator (no platform SET ROLE),
--    then ALTER DEFAULT PRIVILEGES FOR ROLE <captured creator> IN SCHEMA public
--    GRANT <captured privileges only> ON <captured type> TO <captured client>.
--    Preserve each self grantor; never create/grant membership to platform roles.
-- 3. Restores MAINTAIN only when captured AND server_version_num >= 170000.
--    Stop on downgrade/unsupported captured privileges; do not silently omit.
-- 4. Compares restored raw/exploded ACLs with PREINSTALL, including sparse/absent
--    rows; verifies all nonclient entries and all global/other-schema rows remain
--    byte-for-byte unchanged. No global REVOKE/GRANT PUBLIC function workaround.
-- 5. Verifies direct and inherited client sources against the capture, accounting
--    separately for built-in function PUBLIC EXECUTE and per-function revokes.
-- Object ACL recovery is separate; defaults do not modify existing objects.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(741293, 1);
do $$
begin
  raise exception 'Recovery blocked: require fresh preinstall default ACL capture, exact subset assertions and separately approved creator-specific restoration';
end;
$$;
commit;