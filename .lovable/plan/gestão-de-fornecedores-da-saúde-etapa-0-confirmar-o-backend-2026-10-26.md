# Gestão de Fornecedores da Saúde — Etapa 0 concluída (registro atualizado em 2026-11-04)

## Conexões confirmadas
- Repositório oficial: `artemiosds/supabase-connected-app`, branch `main`.
- Projeto Supabase conectado: `SMS2` (`rwbbznqtocunzrpcvjvk`), ativo e saudável, região `sa-east-1`.
- Banco: PostgreSQL 17.11.
- Projeto Lovable: `0f44b9ce-9cdb-4fc9-892b-0bd2cf70b798`. O preview acompanha o commit da branch `main`; Lovable é usado apenas para visualização.

## Diagnóstico somente leitura
- Nenhuma tabela foi encontrada nos schemas `public` e `app_auth`; o histórico de migrações do projeto está vazio.
- Foi identificada a função `public.rls_auto_enable()` (`SECURITY DEFINER`) ligada ao event trigger `ensure_rls`. O Supabase Security Advisor alerta que `anon` e `authenticated` possuem `EXECUTE` nessa função. É necessário revisar a exposição direta sem desativar o mecanismo interno de RLS.
- O projeto já contém frontend de autenticação, painel, organizações, usuários e configurações; não é um projeto em branco.

## Fase 1 — escopo mantido
- Fundação multitenant: perfis, tenants, associações, catálogo de permissões, papéis por tenant, superadministrador global, RLS e auditoria.
- A criação de tenants é exclusiva de superadministrador global e seleciona um usuário já cadastrado para ser administrador municipal. O superadministrador global não é transformado em membro de cada tenant.
- Fornecedores, documentos, PDFs, assinaturas, Google Drive, cobrança e VPS permanecem fora do escopo atual.

## Estado de implantação
- A migração da Fase 1 NÃO foi executada. O banco SMS2 permanece sem tabelas de aplicação e sem migrações da Fase 1.
- Nenhuma alteração de schema, RLS, trigger, função ou privilégio foi realizada no Supabase nesta revisão.
- A proposta SQL precisa de validação em PostgreSQL isolado, revisão final e autorização explícita antes de qualquer implantação.
- Após aprovação e implantação: regenerar os tipos TypeScript, remover o alias temporário em `src/lib/db.ts` e executar testes funcionais de isolamento entre dois tenants.

## Regras permanentes
- Fonte oficial do código: GitHub, branch `main`.
- Alterações de aplicação são feitas no repositório; Lovable é somente preview.
- Nenhuma migração ou alteração no banco sem autorização explícita.
- Preservar o frontend existente e implementar somente o escopo autorizado.
