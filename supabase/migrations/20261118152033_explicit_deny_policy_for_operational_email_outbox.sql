-- Garante política explícita de negação no outbox operacional sem expor registros.
-- A fila permanece acessível exclusivamente via service_role (BYPASSRLS), como projetado.
CREATE POLICY operational_email_events_deny_authenticated
  ON public.operational_email_events
  FOR SELECT TO authenticated
  USING (false);
