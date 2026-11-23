-- Permite que a Edge Function autenticada valide o Administrador Master ativo.
-- O acesso é exclusivo ao service_role; RLS e os privilégios dos clientes permanecem intactos.
GRANT SELECT ON TABLE public.platform_admins TO service_role;
