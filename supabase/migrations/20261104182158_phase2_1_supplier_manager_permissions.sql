-- Ajuste da matriz de permissões e do provisionamento de novas Secretarias.
DELETE FROM public.tenant_role_permissions trp USING public.tenant_roles tr,public.permissions p
WHERE trp.role_id=tr.id AND trp.permission_id=p.id AND tr.is_system AND tr.slug='manager' AND p.code='suppliers:deactivate';
-- No SMS2, create_tenant_with_admin foi atualizada para provisionar o manager
-- com suppliers:view/create/update, sem suppliers:deactivate.
