BEGIN;

CREATE TABLE public.annual_procurement_demands (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  plan_year integer NOT NULL CHECK (plan_year BETWEEN 2000 AND 2200),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 300),
  justification text NOT NULL CHECK (length(trim(justification)) BETWEEN 3 AND 5000),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 200),
  submitted_by uuid NOT NULL REFERENCES auth.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  process_id uuid UNIQUE,
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (process_id IS NULL OR approved_at IS NOT NULL),
  FOREIGN KEY (tenant_id, process_id) REFERENCES public.procurement_processes(tenant_id,id)
);
CREATE INDEX annual_demands_tenant_year ON public.annual_procurement_demands(tenant_id, plan_year, submitted_at);
ALTER TABLE public.annual_procurement_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annual_procurement_demands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.annual_procurement_demands FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.annual_procurement_demands TO authenticated;
CREATE POLICY annual_demands_read ON public.annual_procurement_demands FOR SELECT TO authenticated USING (
  app_auth.has_tenant_data_permission(tenant_id,'documents:view')
  AND app_auth.is_tenant_in_good_standing(tenant_id)
  AND app_auth.is_tenant_module_enabled(tenant_id,'processos')
);

CREATE TRIGGER annual_demands_audit AFTER INSERT OR UPDATE ON public.annual_procurement_demands
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_document_module();

CREATE FUNCTION public.annual_demand_capabilities(p_tenant_id uuid)
RETURNS TABLE(can_create boolean,can_approve boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT app_auth.has_tenant_data_permission(p_tenant_id,'documents:create'),
         app_auth.has_tenant_data_permission(p_tenant_id,'documents:approve')
  WHERE app_auth.has_tenant_data_permission(p_tenant_id,'documents:view')
    AND app_auth.is_tenant_in_good_standing(p_tenant_id)
    AND app_auth.is_tenant_module_enabled(p_tenant_id,'processos');
$$;
REVOKE ALL ON FUNCTION public.annual_demand_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.annual_demand_capabilities(uuid) TO authenticated;

CREATE FUNCTION public.manage_annual_demand(p_tenant_id uuid, p_id uuid, p_action text, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  demand public.annual_procurement_demands;
  process uuid;
  item jsonb;
  qty numeric;
BEGIN
  IF actor IS NULL OR p_id IS NULL OR p_action IS NULL OR p_action NOT IN ('submit','approve','convert')
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id,'documents:view')
     OR NOT app_auth.has_tenant_data_permission(p_tenant_id, CASE WHEN p_action = 'approve' THEN 'documents:approve' ELSE 'documents:create' END)
     OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id)
     OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'processos')
     OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id AND status='active')
  THEN RAISE EXCEPTION 'Operação indisponível para esta Secretaria.' USING ERRCODE='42501'; END IF;

  IF p_action='submit' THEN
    IF jsonb_typeof(p_data->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_data->'items') NOT BETWEEN 1 AND 200
    THEN RAISE EXCEPTION 'Informe de 1 a 200 itens.'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_data->'items') LOOP
      qty := (item->>'quantity')::numeric;
      IF jsonb_typeof(item->'description') IS DISTINCT FROM 'string'
         OR length(trim(item->>'description')) NOT BETWEEN 3 AND 500
         OR jsonb_typeof(item->'unit') IS DISTINCT FROM 'string'
         OR length(trim(item->>'unit')) NOT BETWEEN 1 AND 30
         OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
         OR qty <= 0 OR qty >= 10000000000 OR qty <> round(qty,4)
      THEN RAISE EXCEPTION 'Confira descrição, unidade e quantidade dos itens.'; END IF;
    END LOOP;
    INSERT INTO public.annual_procurement_demands(id,tenant_id,plan_year,title,justification,items,submitted_by)
      VALUES(p_id,p_tenant_id,(p_data->>'year')::integer,trim(p_data->>'title'),trim(p_data->>'justification'),p_data->'items',actor);
    RETURN p_id;
  END IF;

  SELECT * INTO STRICT demand FROM public.annual_procurement_demands
    WHERE tenant_id=p_tenant_id AND id=p_id FOR UPDATE;
  IF p_action='approve' THEN
    UPDATE public.annual_procurement_demands SET approved_at=now(),approved_by=actor
      WHERE id=p_id AND approved_at IS NULL;
    RETURN p_id;
  END IF;
  IF demand.process_id IS NOT NULL THEN RETURN demand.process_id; END IF;
  IF demand.approved_at IS NULL THEN RAISE EXCEPTION 'Aprove a demanda antes de criar o processo.'; END IF;
  process := public.create_procurement_process_with_checklist(p_tenant_id, p_data->>'number',
    demand.title, demand.justification, coalesce(p_data->>'modality',''), 'normal');
  INSERT INTO public.procurement_items(tenant_id,process_id,line_number,description,unit,quantity,created_by,updated_by)
    SELECT p_tenant_id,process,ordinality,trim(value->>'description'),trim(value->>'unit'),
      (value->>'quantity')::numeric,actor,actor FROM jsonb_array_elements(demand.items) WITH ORDINALITY;
  UPDATE public.annual_procurement_demands SET process_id=process WHERE id=p_id;
  RETURN process;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_annual_demand(uuid,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_annual_demand(uuid,uuid,text,jsonb) TO authenticated;
COMMIT;
