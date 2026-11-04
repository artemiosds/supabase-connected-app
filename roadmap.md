# Roadmap — Gestão de Fornecedores da Saúde

- [x] Etapa 0: verify Supabase connection (read-only) — connected project: SMS2 (`rwbbznqtocunzrpcvjvk`), active/healthy
- [x] Connect dedicated Supabase project — done: user connected `SMS2` (ref rwbbznqtocunzrpcvjvk)
- [x] Read-only diagnosis — PostgreSQL 17.11; no application tables in public, no Phase 1 migration history. Existing public event-trigger function `rls_auto_enable()` / event trigger `ensure_rls` were found and must be reviewed.
- [x] Phase 1 frontend foundation — auth, dashboard, organizations, users and settings are implemented. Code was aligned to `active` membership/tenant states and `profiles.full_name`; global superadmins can list all tenants without becoming tenant members, and organization creation selects a pre-registered local administrator.
- [ ] Phase 1 database foundation (tenants, memberships, roles, permissions, audit) — NOT EXECUTED. Candidate SQL still requires isolated PostgreSQL validation and explicit approval before touching SMS2.
- [ ] Post-migration wiring: regenerate `src/integrations/supabase/types.ts`, remove temporary alias in `src/lib/db.ts`, and verify organization creation/membership flows end-to-end.
- [ ] Phase 1 isolation tests — run cross-tenant probes in a disposable PostgreSQL environment before production deployment.
- [ ] Bootstrap first platform superadmin — controlled one-time SQL after migration approval; never a public signup rule.


## Read-only security findings (2026-11-04 UTC)

- Supabase Security Advisor reports `public.rls_auto_enable()` as `SECURITY DEFINER` and executable by `anon` and `authenticated`. It is attached to the DDL event trigger `ensure_rls`. Do not remove the event trigger blindly; review and revoke direct API execution while preserving its internal event-trigger operation.
- No performance advisor findings were returned during this review.
- No database SQL, migration, RLS policy, trigger, or privilege was changed in this review.
