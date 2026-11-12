-- Run only if the history correction was committed and none of the six newer
-- schema migrations has been applied. Application data is untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $revert$
DECLARE
  updated_rows integer;
  deleted_rows integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name IN (
      'validate_supplier_document_external_urls',
      'expand_contract_context_in_document_generation',
      'expand_ten_stage_procurement_workflow',
      'supplier_sanction_history',
      'contract_arp_item_balances',
      'document_template_binary_source'
    )
  ) THEN
    RAISE EXCEPTION 'Ha migrations novas aplicadas; rever o plano antes de reverter o historico.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261106194000'
      AND name = 'restore_operational_process_and_contract_tables'
      AND coalesce(cardinality(statements),0) = 0
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('20261110143000', '20261110180336', 'platform_internal_staff_default_deny_and_support_fk_indexes'),
      ('20261110144000', '20261110180349', 'revoke_pending_internal_invitations'),
      ('20261110150000', '20261110180400', 'platform_staff_remaining_fk_indexes'),
      ('20261110151000', '20261110180414', 'expiry_notification_outbox'),
      ('20261110210500', '20261110234352', 'remove_duplicate_contract_index_and_index_workflow_actor_fks'),
      ('20261110230000', '20261111021638', 'fix_duplicate_contract_amendment_execution'),
      ('20261110230500', '20261111021946', 'link_generated_documents_to_contracts')
    ) AS m(local_version, remote_version, expected_name)
    LEFT JOIN supabase_migrations.schema_migrations h
      ON h.version = m.local_version AND h.name = m.expected_name
    WHERE h.version IS NULL
  ) THEN
    RAISE EXCEPTION 'O historico mudou; nenhuma reversao foi feita.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version IN (
      '20261110180336','20261110180349','20261110180400','20261110180414',
      '20261110234352','20261111021638','20261111021946'
    )
  ) THEN
    RAISE EXCEPTION 'Uma versao original ja existe; nenhuma reversao foi feita.';
  END IF;

  WITH mapping(local_version, remote_version, expected_name) AS (VALUES
    ('20261110143000', '20261110180336', 'platform_internal_staff_default_deny_and_support_fk_indexes'),
    ('20261110144000', '20261110180349', 'revoke_pending_internal_invitations'),
    ('20261110150000', '20261110180400', 'platform_staff_remaining_fk_indexes'),
    ('20261110151000', '20261110180414', 'expiry_notification_outbox'),
    ('20261110210500', '20261110234352', 'remove_duplicate_contract_index_and_index_workflow_actor_fks'),
    ('20261110230000', '20261111021638', 'fix_duplicate_contract_amendment_execution'),
    ('20261110230500', '20261111021946', 'link_generated_documents_to_contracts')
  )
  UPDATE supabase_migrations.schema_migrations h
  SET version = m.remote_version
  FROM mapping m
  WHERE h.version = m.local_version AND h.name = m.expected_name;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 7 THEN
    RAISE EXCEPTION 'Reversao incompleta: % versoes; transacao cancelada.', updated_rows;
  END IF;

  DELETE FROM supabase_migrations.schema_migrations
  WHERE version = '20261106194000'
    AND name = 'restore_operational_process_and_contract_tables'
    AND coalesce(cardinality(statements),0) = 0;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  IF deleted_rows <> 1 THEN
    RAISE EXCEPTION 'Baseline inesperada: % linhas; transacao cancelada.', deleted_rows;
  END IF;
END;
$revert$;
COMMIT;
