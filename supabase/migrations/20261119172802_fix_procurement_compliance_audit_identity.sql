BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- Process compliance uses (tenant_id, process_id), unlike the other audited
-- document tables which have a standalone id. Preserve the existing audit
-- event shape and record the process as the entity identifier.
CREATE OR REPLACE FUNCTION public.fn_audit_document_module()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_fields jsonb; v_entity text := TG_TABLE_NAME; v_tenant_id uuid; v_id uuid;
BEGIN
  v_tenant_id := NEW.tenant_id;
  IF TG_TABLE_NAME = 'procurement_process_compliance' THEN
    v_id := NEW.process_id;
  ELSE
    v_id := NEW.id;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_fields := '["created"]'::jsonb;
  ELSE
    SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key),'[]'::jsonb) INTO v_fields
    FROM jsonb_each(to_jsonb(NEW)) n(key,value)
    WHERE n.key NOT IN ('updated_at','updated_by')
      AND (to_jsonb(OLD)->n.key) IS DISTINCT FROM n.value;
  END IF;
  INSERT INTO public.audit_events(tenant_id,actor_id,action,entity,entity_id,details,created_at)
  VALUES(v_tenant_id,(SELECT auth.uid()),TG_OP,v_entity,v_id::text,jsonb_build_object('changed_fields',v_fields),now());
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_audit_document_module() FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
