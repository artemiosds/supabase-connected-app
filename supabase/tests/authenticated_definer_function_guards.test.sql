-- Individual authorization guard regression for every public SECURITY DEFINER
-- RPC currently executable by authenticated users in the SMS2 schema.
-- All checks run against a disposable local Supabase database in CI.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(38);

SELECT extensions.is(
 (SELECT count(*)::integer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')),
 35,
 'the individually reviewed authenticated SECURITY DEFINER API surface remains exactly 35 functions'
);

SELECT extensions.is(
 (SELECT count(*)::integer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')),
 0,
 'none of the reviewed authenticated SECURITY DEFINER functions is executable by anon'
);

SELECT extensions.is(
 (SELECT count(*)::integer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND NOT (COALESCE(p.proconfig,ARRAY[]::text[]) @> ARRAY['search_path=""'])),
 0,
 'every reviewed authenticated SECURITY DEFINER function pins an empty search_path'
);

WITH reviewed(signature, test_name, required_fragments) AS (
 VALUES
 ('public.activate_my_platform_staff()','activate_my_platform_staff binds activation to the current authenticated and confirmed account',ARRAY['%auth.uid()%','%email_confirmed_at%']::text[]),
 ('public.activate_my_platform_support_agent()','activate_my_platform_support_agent binds activation to the current authenticated and confirmed account',ARRAY['%auth.uid()%','%email_confirmed_at%']::text[]),
 ('public.can_invite_platform_staff(text)','can_invite_platform_staff requires Master authorization',ARRAY['%app_auth.is_platform_admin()%']::text[]),
 ('public.can_manage_platform_staff()','can_manage_platform_staff delegates to the Master authorization helper',ARRAY['%app_auth.is_platform_admin()%']::text[]),
 ('public.can_manage_platform_support_team()','can_manage_platform_support_team delegates to the scoped support authorization helper',ARRAY['%app_auth.can_manage_platform_support_team()%']::text[]),
 ('public.end_platform_support_session(uuid)','end_platform_support_session can close only the current actor own session',ARRAY['%actor_id=(SELECT auth.uid())%']::text[]),
 ('public.get_document_workflow_capabilities(uuid)','get_document_workflow_capabilities checks tenant permission, standing and module access',ARRAY['%has_tenant_data_permission%','%is_tenant_in_good_standing%','%is_tenant_module_enabled%']::text[]),
 ('public.get_my_platform_staff_access()','get_my_platform_staff_access reads only the current user staff record',ARRAY['%user_id=(SELECT auth.uid())%']::text[]),
 ('public.get_my_platform_support_status()','get_my_platform_support_status scopes returned support status to the current user',ARRAY['%auth.uid()%']::text[]),
 ('public.get_platform_staff_metrics()','get_platform_staff_metrics requires an explicit internal metrics or billing permission',ARRAY['%has_platform_staff_permission%']::text[]),
 ('public.get_tenant_role_management_capability(uuid)','get_tenant_role_management_capability checks tenant role permission and commercial standing',ARRAY['%has_tenant_permission%','%is_tenant_in_good_standing%']::text[]),
 ('public.list_generated_document_workflows(uuid)','list_generated_document_workflows checks view permission, standing and document module',ARRAY['%documents:view%','%is_tenant_in_good_standing%','%is_tenant_module_enabled%']::text[]),
 ('public.list_my_platform_support_tenants_safe()','list_my_platform_support_tenants_safe limits results to the current assigned support agent and view flag',ARRAY['%agent_user_id=(SELECT auth.uid())%','%can_view_suppliers%']::text[]),
 ('public.list_platform_staff()','list_platform_staff requires Master authorization',ARRAY['%app_auth.is_platform_admin()%']::text[]),
 ('public.list_platform_staff_audit_events(integer)','list_platform_staff_audit_events requires audit.view permission',ARRAY['%audit.view%']::text[]),
 ('public.list_platform_staff_roles()','list_platform_staff_roles requires Master authorization',ARRAY['%app_auth.is_platform_admin()%']::text[]),
 ('public.list_platform_staff_tenants()','list_platform_staff_tenants requires at least one explicit client, plan, billing or support permission',ARRAY['%clients.view%','%plans.view%','%billing.summary.view%']::text[]),
 ('public.list_platform_support_assignments(uuid)','list_platform_support_assignments requires support-team management permission',ARRAY['%app_auth.can_manage_platform_support_team()%']::text[]),
 ('public.list_platform_support_candidates()','list_platform_support_candidates requires support-team management permission',ARRAY['%app_auth.can_manage_platform_support_team()%']::text[]),
 ('public.list_platform_support_team()','list_platform_support_team requires support-team management permission',ARRAY['%app_auth.can_manage_platform_support_team()%']::text[]),
 ('public.list_tenant_admin_candidates()','list_tenant_admin_candidates requires Master authorization',ARRAY['%app_auth.is_platform_admin()%']::text[]),
 ('public.record_contract_item_consumption(uuid,uuid,numeric,text,text)','record_contract_item_consumption binds the actor and checks tenant permission and contract module',ARRAY['%auth.uid()%','%has_tenant_data_permission%','%is_tenant_module_enabled%']::text[]),
 ('public.register_platform_staff(uuid,text,text,uuid[])','register_platform_staff requires Master authorization and validates the invited Auth account',ARRAY['%app_auth.is_platform_admin()%','%email_confirmed_at%']::text[]),
 ('public.register_platform_support_agent(uuid,text,text,uuid,boolean,boolean,boolean)','register_platform_support_agent requires scoped support-management permission and validates the Auth account',ARRAY['%app_auth.can_manage_platform_support_team()%','%email_confirmed_at%']::text[]),
 ('public.reverse_contract_item_consumption(uuid,uuid,text)','reverse_contract_item_consumption binds the actor and checks tenant permission and contract module',ARRAY['%auth.uid()%','%has_tenant_data_permission%','%is_tenant_module_enabled%']::text[]),
 ('public.revoke_platform_staff_invitation(uuid)','revoke_platform_staff_invitation requires Master authorization',ARRAY['%app_auth.is_platform_admin()%']::text[]),
 ('public.revoke_platform_support_invitation(uuid)','revoke_platform_support_invitation requires scoped support-management permission',ARRAY['%app_auth.can_manage_platform_support_team()%']::text[]),
 ('public.save_platform_staff_role(uuid,text,text,text,text[])','save_platform_staff_role requires Master authorization and retains the base dashboard permission',ARRAY['%app_auth.is_platform_admin()%','%dashboard.view%']::text[]),
 ('public.save_tenant_role_with_permissions(uuid,uuid,text,text,text,uuid[])','save_tenant_role_with_permissions checks the tenant role-management permission and tenant-scoped role lookup',ARRAY['%has_tenant_permission%','%r.tenant_id=p_tenant_id%']::text[]),
 ('public.set_platform_staff_roles(uuid,uuid[])','set_platform_staff_roles requires Master authorization',ARRAY['%app_auth.is_platform_admin()%']::text[]),
 ('public.set_platform_staff_status(uuid,text)','set_platform_staff_status requires Master authorization and confirmed Auth identity before reactivation',ARRAY['%app_auth.is_platform_admin()%','%email_confirmed_at%']::text[]),
 ('public.set_platform_support_agent_status(uuid,text)','set_platform_support_agent_status requires scoped support-management permission and confirmed Auth identity before reactivation',ARRAY['%app_auth.can_manage_platform_support_team()%','%email_confirmed_at%']::text[]),
 ('public.set_platform_support_assignment(uuid,uuid,boolean,boolean,boolean,boolean)','set_platform_support_assignment requires support management and an active target agent',ARRAY['%app_auth.can_manage_platform_support_team()%','%a.user_id=p_agent_user_id%','%a.status=''active''%']::text[]),
 ('public.start_platform_support_session(uuid,text)','start_platform_support_session binds the actor, active assignment and time-limited session',ARRAY['%auth.uid()%','%platform_support_assignments%','%expires_at%']::text[]),
 ('public.transition_generated_document_workflow(uuid,uuid,text,text)','transition_generated_document_workflow binds the actor and requires approval permission for decisions',ARRAY['%auth.uid()%','%documents:approve%','%generated_document_workflow_events%']::text[])
)
SELECT extensions.ok(
 COALESCE((
   SELECT pg_catalog.bool_and(
     pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(r.signature)::oid) ILIKE f.fragment
   )
   FROM pg_catalog.unnest(r.required_fragments) AS f(fragment)
 ),false),
 r.test_name
)
FROM reviewed r
ORDER BY r.signature;

SELECT * FROM extensions.finish();
ROLLBACK;
