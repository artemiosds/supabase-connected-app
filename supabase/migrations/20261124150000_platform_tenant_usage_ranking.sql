-- =============================================================================
-- Frente 5 (Painel Master): Ranking de Uso Operacional por Secretaria
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_platform_tenant_usage_ranking()
RETURNS TABLE (
  tenant_id uuid,
  suppliers_count bigint,
  processes_count bigint,
  contracts_count bigint,
  documents_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT app_auth.is_platform_admin() THEN
    RAISE EXCEPTION 'Somente o Administrador Master ativo pode consultar o ranking de uso.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id AS tenant_id,
    COALESCE(s.cnt, 0)::bigint AS suppliers_count,
    COALESCE(p.cnt, 0)::bigint AS processes_count,
    COALESCE(c.cnt, 0)::bigint AS contracts_count,
    COALESCE(d.cnt, 0)::bigint AS documents_count
  FROM public.tenants t
  LEFT JOIN (
    SELECT tenant_id, count(*)::bigint AS cnt
    FROM public.suppliers
    GROUP BY tenant_id
  ) s ON s.tenant_id = t.id
  LEFT JOIN (
    SELECT tenant_id, count(*)::bigint AS cnt
    FROM public.procurement_processes
    GROUP BY tenant_id
  ) p ON p.tenant_id = t.id
  LEFT JOIN (
    SELECT tenant_id, count(*)::bigint AS cnt
    FROM public.contracts
    GROUP BY tenant_id
  ) c ON c.tenant_id = t.id
  LEFT JOIN (
    SELECT tenant_id, count(*)::bigint AS cnt
    FROM public.generated_documents
    GROUP BY tenant_id
  ) d ON d.tenant_id = t.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_platform_tenant_usage_ranking()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_platform_tenant_usage_ranking()
  TO authenticated;
