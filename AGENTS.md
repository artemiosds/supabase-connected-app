<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits pushed to the connected branch sync back to Lovable and appear in
> the editor. Keep the branch in a working state.
<!-- LOVABLE:END -->

## Engineering rules

- GitHub `main` is the authoritative application source. Lovable is the connected editor/preview surface; avoid out-of-band changes that desynchronize the repository.
- Supabase SMS2 is the managed database. Every future schema change must be a new timestamped migration under `supabase/migrations`. Never rewrite an already-applied migration.
- The 47 migration versions in SMS2 were reconciled against 47 SQL files in this repository on 2026-11-08 (Fortaleza local time). The latest migrations add atomic process/checklist creation, freight-inclusive quote selection, and contract-amendment value/date guards. Reconcile again before every schema release.
- Tenant isolation is enforced in PostgreSQL through RLS, composite foreign keys and server-side permission helpers. Never rely on client-side filters, hidden controls or user-editable JWT metadata for authorization.
- All 24 application tables in the `public` schema currently have RLS enabled; 13 use FORCE ROW LEVEL SECURITY. The operational tables for suppliers, documents, procurement processes/items/quotes/budgets and contracts must remain tenant-isolated by their restrictive RLS policies and composite foreign keys.
- Privileged authorization helpers belong in the non-exposed `app_auth` schema, use `SECURITY DEFINER` only where needed, set a fixed empty `search_path`, and validate the current authenticated identity. Do not grant `anon` access. Verify in Supabase Project Settings → API → Exposed schemas that `app_auth` is not exposed.
- `platform_admins` is separate from municipal tenant roles. Tenant administrators must never grant global platform privileges. Global platform administrators do not automatically receive operational access to tenant supplier/document records.
- Audit events are written by database triggers. Do not add direct client insert/update/delete permissions for `audit_events`. Record changed-field names, not sensitive document contents.
- Use generated database types from `src/integrations/supabase/types.ts`; `src/lib/db.ts` exports only the typed Supabase client (`db`). Do not reintroduce the legacy untyped `dbFase3` alias or `any` query clients.
- Prefer archive/status semantics over physical deletion. Preserve audit history and signed-document immutability.
- Tests against SMS2 that create fixtures must run in transactions and end with ROLLBACK. Never leave fictitious users, tenants, suppliers, processes, contracts, documents or invitations in the shared project. The atomic process/checklist RPC, freight-inclusive quote selection, and contract amendment sign/date/maximum-suppression guards have been tested in rolled-back transactions.
- The official package lockfile is `bun.lock`. CI and development instructions must use Bun and frozen-lockfile installation.
- Let the TanStack router plugin regenerate `src/routeTree.gen.ts`; do not manually rewrite generated metadata.
- Never expose `service_role`, secret keys, passwords, JWTs or other privileged credentials in browser code or committed files.
- State external integration limits honestly: Drive links are recognized but OAuth/upload/sync are not configured; PDFs currently use browser printing; current signing is simple electronic signing, not ICP-Brasil qualified signing; expiry indicators do not yet send scheduled e-mail/WhatsApp alerts.
