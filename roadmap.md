# Roadmap — Gestão de Fornecedores da Saúde

- [x] Etapa 0: verify Supabase connection (read-only) — result: none connected
- [x] Connect dedicated Supabase project — done: user connected `SMS2` (ref rwbbznqtocunzrpcvjvk)
- [x] Read-only diagnosis of the dedicated project — result: public schema is EMPTY (no tables, no functions, no policies; Postgres 14.18)
- [x] Phase 1 frontend foundation (auth pages, admin layout, dashboard, organizations, users, settings) — built; data pages show "database pending" states until the migration runs
- [ ] Phase 1 migration (tenants, memberships, roles, permissions, audit) — BLOCKED: SQL presented, awaiting user's explicit approval before execution
- [ ] Post-migration wiring: switch `src/lib/db.ts` alias to generated typed client, verify org creation + membership flows end-to-end
- [ ] Phase 1 isolation tests (RLS cross-tenant probes) — needs migration applied first
- [ ] Bootstrap the first platform superadmin — controlled SQL procedure, needs user's email; never a public signup rule
