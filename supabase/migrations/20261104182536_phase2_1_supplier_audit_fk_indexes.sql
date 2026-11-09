-- Índices de suporte às FKs de autoria/auditoria de fornecedores.
CREATE INDEX IF NOT EXISTS idx_suppliers_created_by ON public.suppliers(created_by);
CREATE INDEX IF NOT EXISTS idx_suppliers_updated_by ON public.suppliers(updated_by);
