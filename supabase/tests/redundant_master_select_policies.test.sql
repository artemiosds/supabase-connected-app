-- Regression coverage for redundant Master SELECT policies.
-- The primary permissive policy keeps the identical Master exception and
-- tenant permission check; restrictive commercial module/standing policies
-- must remain in place.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(21);

SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='contract_amendments'
    AND policyname='p_master_support_read_contract_amendments'
), 'redundant Master SELECT policy is removed from contract amendments');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='contracts'
    AND policyname='p_master_support_read_contracts'
), 'redundant Master SELECT policy is removed from contracts');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='document_templates'
    AND policyname='p_master_support_read_document_templates'
), 'redundant Master SELECT policy is removed from document templates');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='generated_documents'
    AND policyname='p_master_support_read_generated_documents'
), 'redundant Master SELECT policy is removed from generated documents');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='process_items'
    AND policyname='p_master_support_read_process_items'
), 'redundant Master SELECT policy is removed from process items');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='procurement_processes'
    AND policyname='p_master_support_read_procurement_processes'
), 'redundant Master SELECT policy is removed from procurement processes');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='supplier_documents'
    AND policyname='p_master_support_read_supplier_documents'
), 'redundant Master SELECT policy is removed from supplier documents');

SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='contract_amendments'
    AND policyname='p_amend_select' AND permissive='PERMISSIVE'
    AND qual ILIKE '%has_tenant_data_permission%'
    AND qual ILIKE '%is_platform_admin%'
), 'amendment SELECT policy retains tenant and Master authorization');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='contracts'
    AND policyname='p_contracts_select' AND permissive='PERMISSIVE'
    AND qual ILIKE '%has_tenant_data_permission%'
    AND qual ILIKE '%is_platform_admin%'
), 'contract SELECT policy retains tenant and Master authorization');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='document_templates'
    AND policyname='p_document_templates_select' AND permissive='PERMISSIVE'
    AND qual ILIKE '%has_tenant_data_permission%'
    AND qual ILIKE '%is_platform_admin%'
), 'template SELECT policy retains tenant and Master authorization');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='generated_documents'
    AND policyname='p_generated_documents_select' AND permissive='PERMISSIVE'
    AND qual ILIKE '%has_tenant_data_permission%'
    AND qual ILIKE '%is_platform_admin%'
), 'generated document SELECT policy retains tenant and Master authorization');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='process_items'
    AND policyname='p_items_select' AND permissive='PERMISSIVE'
    AND qual ILIKE '%has_tenant_data_permission%'
    AND qual ILIKE '%is_platform_admin%'
), 'process item SELECT policy retains tenant and Master authorization');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='procurement_processes'
    AND policyname='p_processes_select' AND permissive='PERMISSIVE'
    AND qual ILIKE '%has_tenant_data_permission%'
    AND qual ILIKE '%is_platform_admin%'
), 'procurement process SELECT policy retains tenant and Master authorization');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='supplier_documents'
    AND policyname='p_supplier_documents_select' AND permissive='PERMISSIVE'
    AND qual ILIKE '%has_tenant_data_permission%'
    AND qual ILIKE '%is_platform_admin%'
), 'supplier document SELECT policy retains tenant and Master authorization');

SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='contract_amendments'
    AND policyname='p_commercial_select_contract_amendments'
    AND permissive='RESTRICTIVE'
), 'restrictive commercial gate remains on contract amendments');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='contracts'
    AND policyname='p_commercial_select_contracts'
    AND permissive='RESTRICTIVE'
), 'restrictive commercial gate remains on contracts');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='document_templates'
    AND policyname='p_commercial_select_document_templates'
    AND permissive='RESTRICTIVE'
), 'restrictive commercial gate remains on document templates');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='generated_documents'
    AND policyname='p_commercial_select_generated_documents'
    AND permissive='RESTRICTIVE'
), 'restrictive commercial gate remains on generated documents');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='process_items'
    AND policyname='p_commercial_select_process_items'
    AND permissive='RESTRICTIVE'
), 'restrictive commercial gate remains on process items');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='procurement_processes'
    AND policyname='p_commercial_select_procurement_processes'
    AND permissive='RESTRICTIVE'
), 'restrictive commercial gate remains on procurement processes');
SELECT extensions.ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_policies
  WHERE schemaname='public' AND tablename='supplier_documents'
    AND policyname='p_commercial_select_supplier_documents'
    AND permissive='RESTRICTIVE'
), 'restrictive commercial gate remains on supplier documents');

SELECT * FROM extensions.finish();
ROLLBACK;
