-- Restore the shared tenant-row identity trigger function before Phase 5.2 attaches it.
-- The function rejects tenant reassignment and mutation of creation metadata.
CREATE OR REPLACE FUNCTION public.fn_protect_tenant_row_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Não é permitido alterar organização, autoria ou data de criação.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_protect_tenant_row_identity()
  FROM PUBLIC,anon,authenticated,service_role;
