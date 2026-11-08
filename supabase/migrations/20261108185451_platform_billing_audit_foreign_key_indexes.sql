BEGIN;
CREATE INDEX IF NOT EXISTS idx_platform_payment_integrations_created_by
  ON public.platform_payment_integrations (created_by);
CREATE INDEX IF NOT EXISTS idx_platform_payment_integrations_updated_by
  ON public.platform_payment_integrations (updated_by);
COMMIT;