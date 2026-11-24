-- =============================================================================
-- FRENTE 1: Hardening de segurança — Revogar EXECUTE de PUBLIC e anon
-- nas funções SECURITY DEFINER da Fase 2.1 que exigem usuário autenticado.
-- Mantém anon apenas no Portal Externo do Fornecedor (get_supplier_portal_data
-- e submit_supplier_portal_document), que operam por token seguro.
-- =============================================================================

BEGIN;

-- Trigger function (não deve ser invocável via API por anon ou authenticated)
REVOKE ALL ON FUNCTION public.fn_auto_create_document_task() FROM PUBLIC, anon, authenticated;

-- RPCs de homologação, regularidade, tarefas e geração de token (exigem usuário autenticado)
REVOKE ALL ON FUNCTION public.start_supplier_homologation(uuid, uuid, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_supplier_homologation(uuid, uuid, text, text, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.conclude_supplier_homologation(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conclude_supplier_homologation(uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_supplier_regularity_check(uuid, uuid, text, text, text, text, date, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_regularity_check(uuid, uuid, text, text, text, text, date, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.create_supplier_task(uuid, uuid, text, text, text, text, date, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_task(uuid, uuid, text, text, text, text, date, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_supplier_task(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_supplier_task(uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_supplier_pending_tasks_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_pending_tasks_summary(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_supplier_pending_tasks(uuid, uuid, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_supplier_pending_tasks(uuid, uuid, text, text, text, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.generate_supplier_portal_token(uuid, uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_supplier_portal_token(uuid, uuid, uuid, integer) TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20261124120000', ARRAY['-- 20261124120000_revoke_anon_from_supplier_security_definers'], 'revoke_anon_from_supplier_security_definers')
ON CONFLICT (version) DO NOTHING;

COMMIT;
