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


## Security follow-up (2026-11-04)

- The database Security Advisor still reports direct `EXECUTE` grants on `public.rls_auto_enable()` for `anon` and `authenticated`. It is owned by `postgres` and attached to the enabled `ensure_rls` DDL event trigger.
- A minimal migration script was added at `supabase/migrations/20261104020000_restrict_rls_auto_enable_execute.sql`. It revokes direct API execution and performs an in-transaction disposable-table test to prove automatic RLS remains enabled. The database deployment action was blocked by the execution security controls; **this migration is committed but NOT applied**. Current DB ACLs remain unchanged and the migration history remains empty.
- The Phase 1 candidate SQL was tightened for data minimization: `profiles` stores only `full_name` in this phase (no CPF/phone columns), and changes to `platform_admins` produce global audit events with `tenant_id = NULL`. These changes are in the updated review package, not installed in SMS2.
- No Phase 1 tenant tables, policies, profile triggers, roles, or bootstrap records were installed.
- SQL parser/runtime validation remains pending: this environment did not have PostgreSQL/`psql` available, and external package installation for a parser was unavailable.
