-- Historical metadata correction only. Do not execute with db push.
-- Reviewed against SMS2 and the repository on 12/11/2026.
-- Expected writes: UPDATE exactly seven history rows; INSERT one baseline row.
-- No application tables or user rows are modified.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $repair$
DECLARE
  updated_rows integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('20261110180336', '20261110143000', 'platform_internal_staff_default_deny_and_support_fk_indexes'),
      ('20261110180349', '20261110144000', 'revoke_pending_internal_invitations'),
      ('20261110180400', '20261110150000', 'platform_staff_remaining_fk_indexes'),
      ('20261110180414', '20261110151000', 'expiry_notification_outbox'),
      ('20261110234352', '20261110210500', 'remove_duplicate_contract_index_and_index_workflow_actor_fks'),
      ('20261111021638', '20261110230000', 'fix_duplicate_contract_amendment_execution'),
      ('20261111021946', '20261110230500', 'link_generated_documents_to_contracts')
    ) AS m(remote_version, local_version, expected_name)
    LEFT JOIN supabase_migrations.schema_migrations h
      ON h.version = m.remote_version AND h.name = m.expected_name
    WHERE h.version IS NULL
  ) THEN
    RAISE EXCEPTION 'O historico remoto mudou; nenhuma versao foi reparada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20261106194000','20261110143000','20261110144000','20261110150000',
      '20261110151000','20261110210500','20261110230000','20261110230500'
    )
  ) THEN
    RAISE EXCEPTION 'Uma versao de destino ja existe; nenhuma versao foi reparada.';
  END IF;

  IF (
    SELECT count(*) FROM pg_catalog.pg_class
    WHERE oid IN (
      'public.procurement_processes'::regclass,
      'public.process_items'::regclass,
      'public.contracts'::regclass,
      'public.contract_amendments'::regclass
    ) AND relrowsecurity AND relforcerowsecurity
  ) <> 4 OR pg_catalog.to_regclass('public.ux_suppliers_tenant_id_id') IS NULL THEN
    RAISE EXCEPTION 'A baseline nao foi confirmada no catalogo; nenhuma versao foi reparada.';
  END IF;

  WITH mapping(remote_version, local_version, expected_name) AS (VALUES
    ('20261110180336', '20261110143000', 'platform_internal_staff_default_deny_and_support_fk_indexes'),
    ('20261110180349', '20261110144000', 'revoke_pending_internal_invitations'),
    ('20261110180400', '20261110150000', 'platform_staff_remaining_fk_indexes'),
    ('20261110180414', '20261110151000', 'expiry_notification_outbox'),
    ('20261110234352', '20261110210500', 'remove_duplicate_contract_index_and_index_workflow_actor_fks'),
    ('20261111021638', '20261110230000', 'fix_duplicate_contract_amendment_execution'),
    ('20261111021946', '20261110230500', 'link_generated_documents_to_contracts')
  )
  UPDATE supabase_migrations.schema_migrations h
  SET version = m.local_version
  FROM mapping m
  WHERE h.version = m.remote_version AND h.name = m.expected_name;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 7 THEN
    RAISE EXCEPTION 'Esperadas sete versoes, encontradas %; alteracoes revertidas.', updated_rows;
  END IF;

  INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
  VALUES ('20261106194000', 'restore_operational_process_and_contract_tables', ARRAY[]::text[]);
END;
$repair$;
COMMIT;
