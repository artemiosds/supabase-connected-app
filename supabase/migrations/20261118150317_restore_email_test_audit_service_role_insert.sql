-- Concede exclusivamente à Edge Function (service_role) inserção de eventos de auditoria.
-- Preserva integralmente RLS e os privilégios de anon/authenticated.
GRANT INSERT ON TABLE public.audit_events TO service_role;
