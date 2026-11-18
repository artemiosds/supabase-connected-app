BEGIN;

ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS manager_user_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contracts'::regclass AND conname = 'contracts_manager_user_id_fk') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_manager_user_id_fk
      FOREIGN KEY (tenant_id, manager_user_id) REFERENCES public.tenant_memberships (tenant_id, user_id);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS contracts_manager_user_id_idx
  ON public.contracts (tenant_id, manager_user_id) WHERE manager_user_id IS NOT NULL;

ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS inspector_user_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contracts'::regclass AND conname = 'contracts_inspector_user_id_fk') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_inspector_user_id_fk
      FOREIGN KEY (tenant_id, inspector_user_id) REFERENCES public.tenant_memberships (tenant_id, user_id);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS contracts_inspector_user_id_idx
  ON public.contracts (tenant_id, inspector_user_id) WHERE inspector_user_id IS NOT NULL;

ALTER TABLE public.process_items ADD COLUMN IF NOT EXISTS responsible_user_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.process_items'::regclass AND conname = 'process_items_responsible_user_id_fk') THEN
    ALTER TABLE public.process_items ADD CONSTRAINT process_items_responsible_user_id_fk
      FOREIGN KEY (tenant_id, responsible_user_id) REFERENCES public.tenant_memberships (tenant_id, user_id);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS process_items_responsible_user_id_idx
  ON public.process_items (tenant_id, responsible_user_id) WHERE responsible_user_id IS NOT NULL;

ALTER TABLE public.procurement_processes ADD COLUMN IF NOT EXISTS responsible_user_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.procurement_processes'::regclass AND conname = 'procurement_processes_responsible_user_id_fk') THEN
    ALTER TABLE public.procurement_processes ADD CONSTRAINT procurement_processes_responsible_user_id_fk
      FOREIGN KEY (tenant_id, responsible_user_id) REFERENCES public.tenant_memberships (tenant_id, user_id);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS procurement_processes_responsible_user_id_idx
  ON public.procurement_processes (tenant_id, responsible_user_id) WHERE responsible_user_id IS NOT NULL;

COMMIT;
