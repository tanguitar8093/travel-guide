-- GATED RECOVERY TEMPLATE: intentionally cannot create historical triggers.
-- The forward migration accepts both a clean baseline (zero old triggers, even
-- without touch_updated_at) and the exact captured live five. Poststate alone
-- cannot distinguish them. Function existence is NOT evidence of installation.
-- Historical reference: private convergence-live-install-qD4Kpw before/after
-- catalogs contain all five; this is research evidence, not a NEW preinstall
-- receipt for this migration. Do not fabricate a generic all-five inverse.
--
-- Before authorizing installation/recovery, freeze fresh private preinstall
-- metadata + migration/recovery hashes and retain the actual removed inventory.
-- A separately approved, rehearsed recovery must validate that receipt, exact
-- function bodies/owners/config/ACLs and current replacement trigger definitions,
-- timing, enabled mode, args, WHEN, table owner and absence of later drift.
-- If preinstall had zero legacy triggers: restore ZERO (no-op).
-- If it had the exact five: recreate ONLY those five captured CREATE TRIGGER
-- statements, with captured enabled modes, after guarding ALL targets first.
-- Reject partial inventories, existing legacy names, missing/changed replacement
-- or historical functions. Do not replace functions, touch validation triggers,
-- alter permissions/defaults, replay a baseline, or restore business data.
-- Check exact non-target catalog/data preservation before committing recovery.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_catalog.pg_advisory_xact_lock(741293, 1);
do $$
begin
  raise exception 'Timestamp recovery blocked: require fresh preinstall removed-trigger evidence and separately approved exact recovery';
end;
$$;
commit;