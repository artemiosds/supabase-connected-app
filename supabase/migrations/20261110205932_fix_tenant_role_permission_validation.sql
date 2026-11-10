CREATE OR REPLACE FUNCTION public.save_tenant_role_with_permissions(
 p_tenant_id uuid,p_role_id uuid,p_name text,p_slug text,p_description text,p_permission_ids uuid[]
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_role_id uuid; v_count bigint; v_distinct bigint;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT app_auth.has_tenant_permission(p_tenant_id,'roles:manage')
    OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) THEN
  RAISE EXCEPTION 'Sem permissão para administrar perfis desta Secretaria.' USING ERRCODE='42501';
 END IF;
 IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 2 AND 80
    OR p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9_-]{1,59}$'
    OR (p_description IS NOT NULL AND pg_catalog.length(p_description)>300) THEN
  RAISE EXCEPTION 'Nome, identificador ou descrição do perfil inválidos.';
 END IF;
 IF p_permission_ids IS NULL OR pg_catalog.cardinality(p_permission_ids)=0 THEN
  RAISE EXCEPTION 'Selecione ao menos uma permissão para o perfil.';
 END IF;
 SELECT pg_catalog.count(*),pg_catalog.count(DISTINCT input.permission_id)
 INTO v_count,v_distinct
 FROM pg_catalog.unnest(p_permission_ids) AS input(permission_id)
 JOIN public.permissions p ON p.id=input.permission_id;
 IF v_count<>pg_catalog.cardinality(p_permission_ids) OR v_distinct<>pg_catalog.cardinality(p_permission_ids) THEN
  RAISE EXCEPTION 'A lista contém permissões inexistentes ou repetidas.';
 END IF;
 IF p_role_id IS NULL THEN
  INSERT INTO public.tenant_roles(tenant_id,name,slug,description,is_system)
  VALUES(p_tenant_id,pg_catalog.btrim(p_name),p_slug,NULLIF(pg_catalog.btrim(p_description),''),false)
  RETURNING id INTO v_role_id;
 ELSE
  SELECT r.id INTO v_role_id FROM public.tenant_roles r
  WHERE r.id=p_role_id AND r.tenant_id=p_tenant_id AND NOT r.is_system FOR UPDATE;
  IF v_role_id IS NULL THEN RAISE EXCEPTION 'Perfil personalizado não encontrado ou perfil nativo protegido.'; END IF;
  UPDATE public.tenant_roles SET name=pg_catalog.btrim(p_name),slug=p_slug,
   description=NULLIF(pg_catalog.btrim(p_description),''),updated_at=pg_catalog.now()
  WHERE id=v_role_id AND tenant_id=p_tenant_id;
 END IF;
 DELETE FROM public.tenant_role_permissions rp WHERE rp.role_id=v_role_id;
 INSERT INTO public.tenant_role_permissions(role_id,permission_id)
 SELECT v_role_id,input.permission_id
 FROM pg_catalog.unnest(p_permission_ids) AS input(permission_id);
 INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
 VALUES(p_tenant_id,(SELECT auth.uid()),'tenant_role.permissions_saved','tenant_roles',v_role_id::text,
  jsonb_build_object('permission_ids',p_permission_ids,'is_system',false),pg_catalog.now());
 RETURN v_role_id;
END $$;
REVOKE ALL ON FUNCTION public.save_tenant_role_with_permissions(uuid,uuid,text,text,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_role_with_permissions(uuid,uuid,text,text,text,uuid[]) TO authenticated;