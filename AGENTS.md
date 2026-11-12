<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the user
> may lose their project history.
>
> Commits pushed to the connected branch sync back to Lovable and appear in the
> editor. Keep the branch in a working state.
<!-- LOVABLE:END -->

## Engineering rules

- GitHub `main` is the authoritative application source. Lovable is the connected editor/preview surface; avoid out-of-band changes that desynchronize the repository.
- Supabase SMS2 is the managed production database. Every schema change must be a new timestamped migration under `supabase/migrations`. Never rewrite an already-applied migration.
- As of 2026-11-12, SMS2 has 74 registered migrations through `20261112123300` and `main` has 79 SQL migration files. Five future migrations remain unapplied: `20261112124000_document_template_binary_source.sql`, `20261112124500_tenant_document_branding.sql`, `20261112125000_block_unconfigured_document_fields.sql`, `20261112150000_complete_foreign_key_index_coverage.sql` and `20261112162000_remove_redundant_master_select_policies.sql`. The baseline `20261106194000` is an empty history marker; never reapply it. Review `docs/RECONCILIACAO-MIGRATIONS-SMS2.md` before any schema release.
- Tenant isolation is enforced in PostgreSQL through RLS, composite foreign keys and server-side permission helpers. Never rely on client-side filters, hidden controls or user-editable JWT metadata for authorization.
- As of 2026-11-12, the 38 application tables observed in `public` all had RLS enabled; 27 also had FORCE RLS and the project had 133 RLS policies. Internal staff tables have no direct grants for API roles and are accessed through narrowly-scoped RPCs; preserve this behavior.
- Privileged authorization helpers belong in the non-exposed `app_auth` schema, use `SECURITY DEFINER` only when necessary, set a fixed empty `search_path`, and validate current identity, role, permission and tenant scope. Do not grant `anon` access. Confirm in Supabase Project Settings → API → Exposed schemas that `app_auth` is not exposed.
- Public SECURITY DEFINER functions executable by `authenticated` are intentional RPC endpoints only when their bodies validate identity/role/permission and return only the caller's authorized scope. Do not blanket-revoke them based solely on the generic Advisor warning; review each function and preserve required application flows.
- `platform_admins`, `platform_staff`, `platform_support_agents` and municipal `tenant_memberships` are distinct identity classes. Never merge these roles or automatically grant Master access to internal staff.
- Audit events are written by database triggers or protected RPCs. Do not add direct client insert/update/delete permissions for `audit_events`. Record changed-field names, not document contents, secrets or signed URLs.
- Use generated database types from `src/integrations/supabase/types.ts`; `src/lib/db.ts` exports the typed Supabase client and deterministic pagination helper. Do not reintroduce the legacy untyped `dbFase3` alias or `any` query clients.
- Prefer archive/status semantics over physical deletion. Preserve audit history and signed-document immutability.
- Tests against SMS2 that create fixtures must use transactions and end with ROLLBACK. Never leave fictitious users, tenants, suppliers, processes, contracts, documents or invitations in the shared project.
- During code-only preparation, do not send actual invitation e-mails, create employee accounts, populate operational records or apply pending migrations to SMS2. Use local/disposable CI for database regression tests. Production migrations, secrets, SMTP, DNS and external accounts are separate rollout gates.
- The official package lockfile is `bun.lock`. CI and development instructions must use Bun and frozen-lockfile installation.
- Let the TanStack router plugin regenerate `src/routeTree.gen.ts`; do not manually rewrite generated metadata.
- Never expose `service_role`, secret keys, passwords, JWTs, OAuth refresh tokens or other privileged credentials in browser code, `VITE_*` variables or committed files.
- External integration limits must remain explicit: Google Drive links may be recognized, but OAuth/upload/sync are not configured; PDF is now rendered client-side from the document model with `pdf-lib` (not browser printing), but it is not a full Word/LibreOffice conversion and unsupported DOCX features are warned or blocked; current signing is simple electronic signing, not ICP-Brasil qualified signing; scheduled e-mail/WhatsApp alerts and payment gateway/webhooks are not active.
- Keep the roadmap, GO/NO-GO checklist and integration runbook current. Build green does not equal browser E2E, e-mail delivery, backup restore or production readiness.
