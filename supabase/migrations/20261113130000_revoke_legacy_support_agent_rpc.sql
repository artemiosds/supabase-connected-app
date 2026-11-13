-- Retire the superseded support-agent RPC.
-- The application invites technicians through invite-platform-support-agent,
-- which calls register_platform_support_agent after checking the caller.
-- Keeping the legacy RPC executable allowed a weaker path that could reactivate
-- revoked accounts and bypass the invitation lifecycle.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

REVOKE ALL ON FUNCTION public.add_platform_support_agent(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
