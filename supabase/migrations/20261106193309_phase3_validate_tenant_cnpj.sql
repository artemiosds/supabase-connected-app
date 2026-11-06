-- Garante que o CNPJ institucional passe pela validação oficial existente no banco.
-- A coluna continua opcional para tipos de organização sem CNPJ.
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_cnpj_valid_check
  CHECK (cnpj IS NULL OR public.is_valid_cnpj(cnpj));

COMMENT ON CONSTRAINT tenants_cnpj_valid_check ON public.tenants IS
  'Impede gravar CNPJ institucional inválido; a função is_valid_cnpj também aceita o formato alfanumérico.';