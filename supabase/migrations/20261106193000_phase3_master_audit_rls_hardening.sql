-- Hardening adicional da Fase comercial do Painel Master.
-- As RPCs passam a respeitar as permissões e o RLS da role chamadora.
ALTER FUNCTION public.create_tenant_with_admin_commercial(text,text,uuid,jsonb) SECURITY INVOKER;
ALTER FUNCTION public.get_platform_master_metrics() SECURITY INVOKER;

REVOKE ALL ON FUNCTION public.create_tenant_with_admin_commercial(text,text,uuid,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_admin_commercial(text,text,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.get_platform_master_metrics() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_platform_master_metrics() TO authenticated;

-- A auditoria municipal deve obedecer à situação comercial e ao módulo contratado.
-- Administradores globais mantêm leitura para suporte e auditoria de plataforma.
DROP POLICY IF EXISTS p_commercial_audit_select ON public.audit_events;
CREATE POLICY p_commercial_audit_select
  ON public.audit_events
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    (SELECT app_auth.is_platform_admin())
    OR (
      tenant_id IS NOT NULL
      AND (SELECT app_auth.is_tenant_in_good_standing(tenant_id))
      AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'auditoria'))
    )
  );

COMMENT ON POLICY p_commercial_audit_select ON public.audit_events IS
  'Restringe auditoria municipal ao status comercial e ao modulo contratado; platform_admins preservam leitura de suporte.';