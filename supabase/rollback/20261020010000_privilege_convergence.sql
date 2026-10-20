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
-- Narrowed scope restores only changed postgres defaults; supabase_admin rows
-- remain raw/semantically unchanged. Verify actual executor, DATABASE ownership,
-- effective pg_database_owner/public rights, exact role attributes/memberships
-- and reorder source/owner/config/ACL before recovery; do not grant authority.
-- Include captured database ACL/connection attributes, effective database rights,
-- schema/column ACLs and matching frozen migration/rollback source manifests.
--
-- Exact direct-drift recovery scope (observed grantor postgres; ASSERT each
-- captured object's actual grantor, do not infer it from current ownership):
-- authenticated TRUNCATE/REFERENCES/TRIGGER, and PG17+ MAINTAIN, on precisely
-- public.regions, public.labels, public.places, public.place_regions,
-- public.place_labels, public.trips, public.itinerary_items, public.route_maps,
-- public.route_map_places, public.user_roles (10 tables).
-- anon SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER and PG17+ MAINTAIN
-- on public.user_roles ONLY. Restore only privileges present in the fresh capture.
-- anon EXECUTE on precisely these 11 functions (public schema):
-- app_backup_preview_clear(), app_backup_apply_clear(text),
-- app_backup_account_counts(uuid), app_backup_has_shared_trip(uuid),
-- app_backup_account_signature(uuid), app_backup_assert_payload(jsonb),
-- app_backup_preview_replace(jsonb), app_backup_apply_replace(jsonb,text),
-- can_manage_trip_acl(uuid), assign_private_record_owner(),
-- assign_route_map_record_owner(). authenticated EXECUTE only on the last two
-- trigger functions. Preserve the nine intended authenticated helper grants.
--
-- Before replacing the guard, assert identity/OID/owner and exact postinstall
-- state against the installation capture; stop for any unreviewed later changes.
-- Generate individual object-specific GRANTs using captured postgres grantor
-- authority (authorized SET LOCAL ROLE as needed), not GRANT ALL/schema-wide
-- statements. Assert captured grant options; never introduce absent options.
-- MAINTAIN requires a fresh pg_class ACL capture AND server_version_num >=170000;
-- on older engines do not parse it, and STOP if recovery evidence requires it.
-- Restore only captured MAINTAIN cells; never assume all 10/anon had the grant.
-- Compare raw/exploded ACLs, effective privileges, column ACLs, nonclient entries,
-- owners, memberships and defaults afterward; leave unrelated objects untouched.
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