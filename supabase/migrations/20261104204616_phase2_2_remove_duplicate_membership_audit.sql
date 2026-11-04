-- Remove auditoria duplicada de vínculos; o trigger genérico existente continua ativo.
DROP TRIGGER IF EXISTS trg_tenant_memberships_audit ON public.tenant_memberships;
DROP FUNCTION IF EXISTS public.fn_audit_tenant_membership();
