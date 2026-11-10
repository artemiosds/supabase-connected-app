-- Private idempotent outbox for contract and supplier-document expiry notifications.
-- This migration prepares the schema only; it does not enable a scheduler or send email.

CREATE TABLE public.expiry_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('contract','supplier_document')),
  entity_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  alert_level text NOT NULL CHECK (alert_level IN ('overdue','due','30','60','90','120')),
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT expiry_notification_deliveries_unique_event
    UNIQUE (tenant_id,entity_type,entity_id,recipient_user_id,alert_level,due_on),
  CONSTRAINT expiry_notification_deliveries_sent_consistency
    CHECK ((status='sent') = (sent_at IS NOT NULL))
);

CREATE INDEX idx_expiry_notification_deliveries_pending
  ON public.expiry_notification_deliveries(status,created_at)
  WHERE status IN ('pending','failed');

CREATE INDEX idx_expiry_notification_deliveries_tenant_due
  ON public.expiry_notification_deliveries(tenant_id,due_on DESC);

ALTER TABLE public.expiry_notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expiry_notification_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY p_expiry_notification_deliveries_default_deny
  ON public.expiry_notification_deliveries
  AS RESTRICTIVE
  FOR ALL
  TO anon,authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.expiry_notification_deliveries FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.expiry_notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.claim_expiry_notification_delivery(p_delivery_id uuid)
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  entity_type text,
  entity_id uuid,
  recipient_user_id uuid,
  alert_level text,
  due_on date,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.expiry_notification_deliveries d
  SET status='sending',
      attempts=d.attempts+1,
      locked_at=pg_catalog.now(),
      updated_at=pg_catalog.now()
  WHERE d.id=p_delivery_id
    AND d.attempts < 5
    -- A stuck "sending" record is intentionally not reclaimed automatically:
    -- the provider may have accepted the email before the worker lost its response.
    -- Manual reconciliation is safer than sending a possible duplicate.
    AND d.status IN ('pending','failed')
  RETURNING d.id,d.tenant_id,d.entity_type,d.entity_id,
    d.recipient_user_id,d.alert_level,d.due_on,d.attempts;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_expiry_notification_delivery(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expiry_notification_delivery(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_expiry_notification_delivery(
  p_delivery_id uuid,
  p_status text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF p_status NOT IN ('sent','failed') THEN
    RAISE EXCEPTION 'Invalid delivery status.' USING ERRCODE='22023';
  END IF;

  UPDATE public.expiry_notification_deliveries
  SET status=p_status,
      locked_at=NULL,
      sent_at=CASE WHEN p_status='sent' THEN pg_catalog.now() ELSE NULL END,
      provider_message_id=CASE
        WHEN p_status='sent' THEN NULLIF(pg_catalog.left(p_provider_message_id,255),'')
        ELSE NULL
      END,
      last_error_code=CASE
        WHEN p_status='failed' THEN NULLIF(pg_catalog.left(p_error_code,80),'')
        ELSE NULL
      END,
      updated_at=pg_catalog.now()
  WHERE id=p_delivery_id AND status='sending';

  GET DIAGNOSTICS v_updated=ROW_COUNT;
  RETURN v_updated=1;
END;
$function$;

REVOKE ALL ON FUNCTION public.finish_expiry_notification_delivery(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_expiry_notification_delivery(uuid,text,text,text) TO service_role;

COMMENT ON TABLE public.expiry_notification_deliveries IS
  'Private idempotent outbox for scheduled contract and supplier-document expiry emails. Accessible only to service_role Edge Functions.';
