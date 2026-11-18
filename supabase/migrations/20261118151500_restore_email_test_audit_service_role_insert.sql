-- Permissão mínima para registrar eventos de teste do SMTP pelas Edge Functions.
-- Não concede nenhum privilégio adicional a anon/authenticated nem altera políticas RLS.
BEGIN;

GRANT INSERT ON TABLE public.audit_events TO service_role;

COMMIT;
