BEGIN;
CREATE TABLE public.operational_email_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 kind text NOT NULL CHECK (kind IN ('manager','inspector','stage','idle')),
 entity_id uuid NOT NULL,
 stage text NOT NULL DEFAULT '',
 recipient uuid,
 event_day date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
 status text NOT NULL CHECK(status IN ('pending','sending','sent','skipped','failed','uncertain')),
 reason text,
 claimed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE NULLS NOT DISTINCT (tenant_id,kind,entity_id,stage,recipient,event_day)
);
ALTER TABLE public.operational_email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_email_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.operational_email_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.operational_email_events TO service_role;
CREATE INDEX operational_email_pending ON public.operational_email_events(created_at,id) WHERE status='pending';

CREATE FUNCTION app_auth.enqueue_operational_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text; uid uuid;
BEGIN
 IF TG_TABLE_NAME='contracts' THEN
  FOREACH role_name IN ARRAY ARRAY['manager','inspector'] LOOP
   uid := (to_jsonb(NEW)->>(role_name||'_user_id'))::uuid;
   IF TG_OP='UPDATE' AND uid IS NOT DISTINCT FROM (to_jsonb(OLD)->>(role_name||'_user_id'))::uuid THEN CONTINUE; END IF;
   INSERT INTO public.operational_email_events(tenant_id,kind,entity_id,recipient,status,reason)
   VALUES(NEW.tenant_id,role_name,NEW.id,uid,CASE WHEN uid IS NULL THEN 'skipped' ELSE 'pending' END,
          CASE WHEN uid IS NULL THEN 'NO_ASSIGNEE' END) ON CONFLICT DO NOTHING;
  END LOOP;
 ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
  INSERT INTO public.operational_email_events(tenant_id,kind,entity_id,stage,recipient,status,reason)
  SELECT NEW.tenant_id,'stage',NEW.id,NEW.stage,r.uid,CASE WHEN r.uid IS NULL THEN 'skipped' ELSE 'pending' END,
         CASE WHEN r.uid IS NULL THEN 'NO_ASSIGNEE' END
  FROM (SELECT DISTINCT i.responsible_user_id AS uid FROM public.process_items i
        WHERE i.tenant_id=NEW.tenant_id AND i.process_id=NEW.id AND i.stage=NEW.stage AND NOT i.is_done) r
  ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.process_items i WHERE i.tenant_id=NEW.tenant_id AND i.process_id=NEW.id AND i.stage=NEW.stage AND NOT i.is_done) THEN
   INSERT INTO public.operational_email_events(tenant_id,kind,entity_id,stage,status,reason)
   VALUES(NEW.tenant_id,'stage',NEW.id,NEW.stage,'skipped','NO_ASSIGNEE') ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_auth.enqueue_operational_email() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER enqueue_contract_designation AFTER INSERT OR UPDATE OF manager_user_id,inspector_user_id ON public.contracts
 FOR EACH ROW EXECUTE FUNCTION app_auth.enqueue_operational_email();
CREATE TRIGGER enqueue_process_transition AFTER UPDATE OF stage ON public.procurement_processes
 FOR EACH ROW EXECUTE FUNCTION app_auth.enqueue_operational_email();

CREATE FUNCTION public.queue_idle_process_emails() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.operational_email_events(tenant_id,kind,entity_id,recipient,event_day,status,reason)
 SELECT p.tenant_id,'idle',p.id,p.responsible_user_id,date_trunc('week',now() AT TIME ZONE 'America/Sao_Paulo')::date,
 CASE WHEN p.responsible_user_id IS NULL THEN 'skipped' ELSE 'pending' END,
 CASE WHEN p.responsible_user_id IS NULL THEN 'NO_ASSIGNEE' END
 FROM public.procurement_processes p
 WHERE p.status='em_andamento' AND p.updated_at <= now()-interval '8 days'
 AND NOT EXISTS (SELECT 1 FROM public.process_items i WHERE i.process_id=p.id AND i.tenant_id=p.tenant_id AND i.updated_at>now()-interval '8 days')
 ON CONFLICT DO NOTHING
$$;
REVOKE ALL ON FUNCTION public.queue_idle_process_emails() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_idle_process_emails() TO service_role;
COMMIT;
