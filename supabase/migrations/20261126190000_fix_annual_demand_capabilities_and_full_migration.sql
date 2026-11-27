-- =============================================================================
-- Migração complementar: corrige annual_demand_capabilities (adiciona can_view)
-- e registra a migração 20261126183000 que foi aplicada via execute_sql
-- =============================================================================

-- 1) Recria annual_demand_capabilities com assinatura correta (can_view, can_create, can_approve)
DROP FUNCTION IF EXISTS public.annual_demand_capabilities(uuid);
CREATE FUNCTION public.annual_demand_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_view boolean, can_create boolean, can_approve boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    app_auth.has_tenant_data_permission(p_tenant_id, 'documents:view')
      AND app_auth.is_tenant_in_good_standing(p_tenant_id)
      AND app_auth.is_tenant_module_enabled(p_tenant_id, 'pca'),
    app_auth.has_tenant_data_permission(p_tenant_id, 'documents:create')
      AND app_auth.is_tenant_in_good_standing(p_tenant_id)
      AND app_auth.is_tenant_module_enabled(p_tenant_id, 'pca'),
    (
      app_auth.has_tenant_data_permission(p_tenant_id, 'documents:approve')
      OR app_auth.has_tenant_data_permission(p_tenant_id, 'procurement:approve_price')
    )
      AND app_auth.is_tenant_in_good_standing(p_tenant_id)
      AND app_auth.is_tenant_module_enabled(p_tenant_id, 'pca');
$function$;

REVOKE ALL ON FUNCTION public.annual_demand_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.annual_demand_capabilities(uuid) TO authenticated;

-- 2) Garante que manage_annual_demand tem REVOKE/GRANT corretos
REVOKE ALL ON FUNCTION public.manage_annual_demand(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_annual_demand(uuid, uuid, text, jsonb) TO authenticated;

-- 3) Garante que approve_procurement_item_price tem REVOKE/GRANT corretos
REVOKE ALL ON FUNCTION public.approve_procurement_item_price(uuid, uuid, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_procurement_item_price(uuid, uuid, text, text, text, numeric) TO authenticated;

-- 4) Garante que fn_guard_procurement_quote_source_metadata está aplicada como trigger
-- (idempotente: DROP IF EXISTS + CREATE)
DROP TRIGGER IF EXISTS trg_guard_quote_source_metadata ON public.procurement_price_quotes;
CREATE TRIGGER trg_guard_quote_source_metadata
  BEFORE INSERT OR UPDATE ON public.procurement_price_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_procurement_quote_source_metadata();

-- 5) Registra a migração 20261126183000 no schema_migrations se ainda não existir
-- (foi aplicada via execute_sql mas pode não ter sido registrada pelo CI)
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT
  '20261126183000',
  'processes_pca_and_audit_hardening',
  ARRAY['-- Applied via execute_sql on 2026-11-26']
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version = '20261126183000'
);
