-- Make the internal catalog's default-deny behavior explicit for API roles.
-- These tables are read only by narrowly-scoped SECURITY DEFINER RPCs; API
-- roles intentionally have no direct table grants.
DO $migration$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'platform_staff',
    'platform_staff_roles',
    'platform_staff_permissions',
    'platform_staff_role_permissions',
    'platform_staff_role_assignments'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      'p_' || v_table || '_default_deny',
      v_table
    );
  END LOOP;
END;
$migration$;

-- Cover the remaining support-account foreign keys reported without indexes.
CREATE INDEX IF NOT EXISTS idx_platform_support_agents_created_by
  ON public.platform_support_agents(created_by);

CREATE INDEX IF NOT EXISTS idx_platform_support_assignments_created_by
  ON public.platform_support_assignments(created_by);

CREATE INDEX IF NOT EXISTS idx_platform_support_sessions_ended_by
  ON public.platform_support_sessions(ended_by);
