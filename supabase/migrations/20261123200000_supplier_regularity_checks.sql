-- Migration: 20261123200000_supplier_regularity_checks.sql
-- Fase 2.1: Central de Verificação de Regularidade do Fornecedor e Consultas Oficiais

BEGIN;

-- 1. Tabela de verificacoes de regularidade e consultas oficiais
CREATE TABLE IF NOT EXISTS public.supplier_regularity_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('rfb_cnpj', 'ceis_cgu', 'cnep_cgu', 'tst_cndt', 'caixa_fgts', 'sefaz_estadual', 'pref_municipal', 'anvisa_afe', 'outro')),
  source_label text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('regular', 'irregular', 'pending_review', 'not_found', 'exempt')) DEFAULT 'regular',
  certificate_number text,
  valid_until date,
  evidence_url text,
  evidence_storage_path text,
  notes text,
  requires_action boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_supplier_regularity_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_regularity_tenant_supplier
  ON public.supplier_regularity_checks (tenant_id, supplier_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_regularity_tenant_source
  ON public.supplier_regularity_checks (tenant_id, source, status);

-- 2. Trigger para atualizar updated_at
CREATE OR REPLACE TRIGGER trg_supplier_regularity_updated_at
  BEFORE UPDATE ON public.supplier_regularity_checks
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 3. Habilitar e Forcar RLS
ALTER TABLE public.supplier_regularity_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_regularity_checks FORCE ROW LEVEL SECURITY;

-- 4. Politicas restritivas comerciais
CREATE POLICY p_commercial_select_supplier_regularity ON public.supplier_regularity_checks
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT app_auth.is_platform_admin()) OR ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores'))));

CREATE POLICY p_commercial_insert_supplier_regularity ON public.supplier_regularity_checks
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

CREATE POLICY p_commercial_update_supplier_regularity ON public.supplier_regularity_checks
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')))
  WITH CHECK ((SELECT app_auth.is_tenant_in_good_standing(tenant_id)) AND (SELECT app_auth.is_tenant_module_enabled(tenant_id, 'fornecedores')));

-- 5. Politicas permissivas por permissoes de Secretaria
CREATE POLICY p_supplier_regularity_select ON public.supplier_regularity_checks
  FOR SELECT TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:view'));

CREATE POLICY p_supplier_regularity_insert ON public.supplier_regularity_checks
  FOR INSERT TO authenticated
  WITH CHECK (
    (app_auth.has_supplier_permission(tenant_id, 'suppliers:verify') OR app_auth.has_supplier_permission(tenant_id, 'suppliers:update'))
    AND created_by = (SELECT auth.uid())
  );

CREATE POLICY p_supplier_regularity_update ON public.supplier_regularity_checks
  FOR UPDATE TO authenticated
  USING (app_auth.has_supplier_permission(tenant_id, 'suppliers:verify') OR app_auth.has_supplier_permission(tenant_id, 'suppliers:update'))
  WITH CHECK (app_auth.has_supplier_permission(tenant_id, 'suppliers:verify') OR app_auth.has_supplier_permission(tenant_id, 'suppliers:update'));

-- 6. RPC para registro transacional de verificacao de regularidade
CREATE OR REPLACE FUNCTION public.record_supplier_regularity_check(
  p_tenant_id uuid,
  p_supplier_id uuid,
  p_source text,
  p_source_label text,
  p_status text,
  p_certificate_number text DEFAULT NULL,
  p_valid_until date DEFAULT NULL,
  p_evidence_url text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_requires_action boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_check_id uuid;
BEGIN
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.';
  END IF;

  IF NOT (
    app_auth.has_supplier_permission(p_tenant_id, 'suppliers:verify')
    OR app_auth.has_supplier_permission(p_tenant_id, 'suppliers:update')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: permissao insuficiente para registrar verificacao de regularidade.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = p_supplier_id AND s.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Fornecedor nao encontrado nesta Secretaria.';
  END IF;

  INSERT INTO public.supplier_regularity_checks (
    tenant_id, supplier_id, source, source_label, status,
    certificate_number, valid_until, evidence_url, notes,
    requires_action, created_by
  ) VALUES (
    p_tenant_id, p_supplier_id, p_source, p_source_label, p_status,
    p_certificate_number, p_valid_until, p_evidence_url, p_notes,
    COALESCE(p_requires_action, false), v_user_id
  )
  RETURNING id INTO v_check_id;

  RETURN v_check_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_supplier_regularity_check(uuid, uuid, text, text, text, text, date, text, text, boolean) TO authenticated;

-- Registrar migracao em schema_migrations
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20261123200000', ARRAY['-- 20261123200000_supplier_regularity_checks'], 'supplier_regularity_checks')
ON CONFLICT (version) DO NOTHING;

COMMIT;
