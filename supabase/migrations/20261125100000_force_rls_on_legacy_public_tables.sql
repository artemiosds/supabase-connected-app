BEGIN;

-- Endurecimento de defesa em profundidade (Fase 3 / M5):
-- Garante FORCE ROW LEVEL SECURITY também nas 11 tabelas iniciais do schema public,
-- alinhando todo o schema às tabelas mais recentes do sistema.
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_template_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

COMMIT;
