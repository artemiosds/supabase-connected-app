<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules

- Multitenant isolation lives in Postgres RLS and security-definer functions, never in UI filters or role claims sent by the browser. (Why: the spec requires cross-tenant safety at the database level.)
- `src/lib/db.ts` temporarily casts the generated Supabase client to a loosely typed `SupabaseClient` because the Phase 1 migration has not been applied yet; after the migration runs and `types.ts` regenerates, queries must switch to the typed client and the alias removed.
- Roles/permissions model: `platform_admins` (global superadmins) is a separate table from per-tenant roles in `tenant_roles`/`membership_roles`; tenant admins can never grant global rights. (Why: privilege-escalation protection required by the spec.)
- Audit writes go through a security-definer function (`log_audit_event`); regular users cannot insert/update/delete `audit_events` directly.
- Until the Phase 1 migration is approved and executed, do not run destructive SQL or invent demo tables in the connected project (ref rwbbznqtocunzrpcvjvk); it was verified empty before any changes.
