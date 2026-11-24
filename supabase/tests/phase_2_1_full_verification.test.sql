-- =============================================================================
-- TESTE GERAL DE HOMOLOGAÇÃO DA FASE 2.1 — CENTRAL INTELIGENTE DE FORNECEDORES
-- Primus Gestão — Entrega 8
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(14);

-- 1. Tabela supplier_homologations existe e tem RLS ativado e forçado
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_homologations'::regclass
      AND c.relrowsecurity AND c.relforcerowsecurity
  ),
  'supplier_homologations tem RLS ativo e forçado'
);

-- 2. Tabela supplier_regularity_checks existe e tem RLS ativado e forçado
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_regularity_checks'::regclass
      AND c.relrowsecurity AND c.relforcerowsecurity
  ),
  'supplier_regularity_checks tem RLS ativo e forçado'
);

-- 3. Tabela supplier_pending_tasks existe e tem RLS ativado e forçado
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_pending_tasks'::regclass
      AND c.relrowsecurity AND c.relforcerowsecurity
  ),
  'supplier_pending_tasks tem RLS ativo e forçado'
);

-- 4. Tabela supplier_portal_tokens existe e tem RLS ativado e forçado
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.supplier_portal_tokens'::regclass
      AND c.relrowsecurity AND c.relforcerowsecurity
  ),
  'supplier_portal_tokens tem RLS ativo e forçado'
);

-- 5-8. Proteção contra exclusão física (DELETE negado para authenticated)
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_homologations', 'DELETE'),
  'DELETE negado em supplier_homologations para authenticated'
);

SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_regularity_checks', 'DELETE'),
  'DELETE negado em supplier_regularity_checks para authenticated'
);

SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_pending_tasks', 'DELETE'),
  'DELETE negado em supplier_pending_tasks para authenticated'
);

SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.supplier_portal_tokens', 'DELETE'),
  'DELETE negado em supplier_portal_tokens para authenticated'
);

-- 9-12. RPCs transacionais da Fase 2.1 presentes
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname = 'start_supplier_homologation'),
  'RPC start_supplier_homologation presente'
);

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname = 'record_supplier_regularity_check'),
  'RPC record_supplier_regularity_check presente'
);

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname = 'create_supplier_task'),
  'RPC create_supplier_task presente'
);

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname = 'get_supplier_portal_data'),
  'RPC get_supplier_portal_data presente'
);

-- 13. Permissões essenciais de fornecedores no catálogo
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM public.permissions WHERE code = 'suppliers:view') AND
  EXISTS (SELECT 1 FROM public.permissions WHERE code = 'suppliers:update'),
  'Permissões essenciais de fornecedores cadastradas no catálogo'
);

-- 14. Trigger de atualização de pendências documentais ativo
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'trg_supplier_documents_auto_task'
  ),
  'Trigger automático de tarefas de documentos ativo'
);

SELECT * FROM extensions.finish();
ROLLBACK;
