-- VERIFICACAO SOMENTE-LEITURA DA FUNDAÇÃO MULTITENANT E DAS FASES 1/2 — SMS2
-- Não altera dados nem schema.

-- 1) Tabelas da fundação, fornecedores, documentos e estado RLS.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN (
    'profiles','tenants','tenant_memberships','permissions','tenant_roles',
    'tenant_role_permissions','membership_roles','platform_admins','audit_events',
    'suppliers','supplier_documents','document_templates','generated_documents'
  )
ORDER BY c.relname;

-- 2) Chaves compostas que impedem misturar membro/papel de tenants diferentes.
SELECT conrelid::regclass AS table_name,
       conname,
       pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conname IN (
  'uq_membership_id_tenant',
  'uq_tenant_roles_id_tenant',
  'fk_membership_roles_membership_tenant',
  'fk_membership_roles_role_tenant'
)
ORDER BY conname;

-- 3) Catálogo de permissões.
SELECT code, name, module FROM public.permissions ORDER BY code;

-- 4) ACLs das duas funções privilegiadas/relevantes.
SELECT
  has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') AS anon_can_call_rls_auto_enable,
  has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') AS authenticated_can_call_rls_auto_enable,
  has_function_privilege('service_role','public.rls_auto_enable()','EXECUTE') AS service_role_can_call_rls_auto_enable,
  has_function_privilege('anon','public.create_tenant_with_admin(text,text,uuid)','EXECUTE') AS anon_can_provision,
  has_function_privilege('authenticated','public.create_tenant_with_admin(text,text,uuid)','EXECUTE') AS authenticated_can_call_provision_rpc,
  has_function_privilege('service_role','public.create_tenant_with_admin(text,text,uuid)','EXECUTE') AS service_role_can_provision,
  (SELECT prosecdef FROM pg_catalog.pg_proc
   WHERE oid='public.create_tenant_with_admin(text,text,uuid)'::regprocedure) AS provision_rpc_is_security_definer;

-- 5) Gatilho de perfil e gatilho global de RLS.
SELECT n.nspname AS schema_name, c.relname AS table_name, t.tgname,
       pg_catalog.pg_get_triggerdef(t.oid) AS definition, t.tgenabled
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal
  AND ((n.nspname='auth' AND c.relname='users' AND t.tgname='trg_auth_user_profile')
    OR (n.nspname='public' AND t.tgname LIKE 'trg_audit_%'))
ORDER BY n.nspname,c.relname,t.tgname;

SELECT evtname, evtenabled, evtfoid::regprocedure AS function_name
FROM pg_catalog.pg_event_trigger
WHERE evtname='ensure_rls';

-- 6) Estado do bootstrap.
SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM public.profiles) AS profiles,
  (SELECT count(*) FROM public.platform_admins) AS platform_admins,
  (SELECT count(*) FROM public.tenants) AS tenants,
  (SELECT count(*) FROM public.audit_events) AS audit_events;

-- 7) app_auth existe e precisa permanecer fora de Project Settings > API > Exposed schemas.
SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname='app_auth';
-- A lista Exposed schemas é uma configuração da API no Dashboard; confirme manualmente
-- que app_auth NÃO está incluído. O schema public é o schema de API esperado.
