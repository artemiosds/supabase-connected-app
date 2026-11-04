# Roadmap — Gestão de Fornecedores da Saúde

## Estado da plataforma — Fase 1

- Projeto Supabase existente: **SMS2** (`rwbbznqtocunzrpcvjvk`), região `sa-east-1`, PostgreSQL 17.11.
- Repositório oficial: `artemiosds/supabase-connected-app`, branch `main`.
- Lovable: somente preview, sincronizado com o commit do GitHub.

### Fundação multitenant no banco

<badge>Aplicada no SMS2</badge>

Migrações registradas no Supabase:
1. `20261104131949_restrict_rls_auto_enable_execute` — revogou execução direta da função interna `public.rls_auto_enable()` para as roles da API, preservando o event trigger `ensure_rls`.
2. `20261104132106_phase1_multitenant_foundation` — criou perfis, tenants, vínculos, papéis, permissões, superadministradores e auditoria; aplicou RLS e chaves estrangeiras compostas.
3. `20261104132238_phase1_rls_rpc_and_indexes_hardening` — converteu a RPC de provisionamento para SECURITY INVOKER, explicitou a política de criação de tenants, separou políticas de leitura/escrita e adicionou índices das FKs.
4. `20261104132351_phase1_provisioning_rpc_auth_lookup_fix` — removeu consulta direta a `auth.users` da RPC; a validação usa `profiles`, cuja FK garante a relação com Auth.

### Verificações concluídas

- Nove tabelas da Fase 1 existem e estão com RLS habilitado.
- O catálogo contém nove permissões.
- As FKs compostas vinculam o papel e o membro ao mesmo tenant.
- O trigger `auth.users → profiles` foi testado com metadados preenchidos e sem nome; fallback de nome funcionou.
- Testes transacionais criaram duas secretarias descartáveis, verificaram isolamento entre A e B, tentativa de papel cruzado, proteção de papéis nativos, proteção das permissões do papel admin e recusa de provisionamento por administrador municipal.
- Os testes terminaram com ROLLBACK. Verificação posterior confirmou zero usuários, perfis, tenants, vínculos, superadministradores e eventos de auditoria persistidos.
- Security Advisor: sem findings.
- Performance Advisor: apenas avisos INFO de índices ainda não utilizados, esperado porque o banco ainda não tem carga operacional. Não há mais avisos de FKs sem índice nem políticas permissivas duplicadas.

### Bootstrap inicial — pendente de conta real

- No momento da implantação, `auth.users`, `profiles` e `platform_admins` estão vazios.
- O primeiro superadministrador NÃO foi criado: é necessário que a pessoa autorizada crie sua conta pela tela `/cadastro` e confirme o e-mail.
- Depois disso, executar uma única vez `supabase/operations/bootstrap_first_platform_admin.sql`, substituindo pelo e-mail exato da conta criada. O script falha se não encontrar exatamente uma conta/perfil ou se já existir qualquer registro em `platform_admins`.
- Não existe promoção automática para superadministrador no cadastro público.

### Verificação manual do PostgREST

- `app_auth` foi criado como schema interno e não recebeu grants para `anon`.
- Confirme no Dashboard do Supabase, em **Project Settings → API → Exposed schemas**, que `app_auth` NÃO está listado. A configuração de schemas expostos pertence à API e não é comprovada apenas pelo SQL da migração.
- Consultas somente-leitura: `supabase/operations/phase1_post_deploy_verification.sql`.

## Frontend e preview

- Tipos TypeScript foram regenerados a partir do banco instalado em `src/integrations/supabase/types.ts`.
- `src/lib/db.ts` usa agora o cliente Supabase tipado, sem o alias genérico temporário.
- Compatibilidade alinhada: `active`/ `suspended`, `profiles.full_name`, parâmetros da RPC, seleção de administrador municipal e visão global do superadmin.
- GitHub `main` é a fonte oficial; Lovable é somente preview.

## Próximas fases

- Depois do bootstrap, entrar como superadministrador e criar a primeira Secretaria usando a tela Organizações.
- Em seguida, validar o fluxo no preview e convidar/registrar o administrador municipal.
- Fornecedores, documentos, PDFs, assinaturas, Google Drive, cobrança e VPS continuam fora da Fase 1.
