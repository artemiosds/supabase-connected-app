# Gestão de Fornecedores da Saúde — Fase 1 aplicada (registro atualizado em 2026-11-04)

## Conexões confirmadas
- Repositório oficial: `artemiosds/supabase-connected-app`, branch `main`.
- Supabase: `SMS2` (`rwbbznqtocunzrpcvjvk`), PostgreSQL 17.11.
- Lovable: `0f44b9ce-9cdb-4fc9-892b-0bd2cf70b798`, somente preview.
- O código oficial está no GitHub; alterações visuais ou funcionais devem ser feitas no repositório.

## Fase 1 — banco aplicado
Quatro migrações foram aplicadas e aparecem no histórico do Supabase:
- `20261104131949_restrict_rls_auto_enable_execute`
- `20261104132106_phase1_multitenant_foundation`
- `20261104132238_phase1_rls_rpc_and_indexes_hardening`
- `20261104132351_phase1_provisioning_rpc_auth_lookup_fix`

As nove tabelas da fundação multitenant foram criadas com RLS: profiles, tenants, tenant_memberships, permissions, tenant_roles, tenant_role_permissions, membership_roles, platform_admins e audit_events.

A integridade entre papel, membro e organização é protegida por FKs compostas. A criação de perfis a partir de auth.users foi testada. A RPC de criação de organização é SECURITY INVOKER e só pode ser chamada por authenticated; a própria função valida superadministrador global e o RLS autoriza as operações necessárias.

## Testes concluídos
- Cadastro Auth → criação automática de perfil, incluindo fallback sem metadados de nome.
- Provisionamento de duas secretarias por superadministrador global.
- Um administrador municipal não consegue ver as organizações, membros e perfis da outra secretaria.
- FK composta rejeita vínculo cruzado de papel entre tenants.
- Administrador municipal não cria papel nativo nem altera permissões do papel admin.
- Administrador municipal não consegue chamar a RPC de provisionamento.
- Os testes foram executados em transação e revertidos; nenhum usuário ou tenant fictício permaneceu no banco.
- Security Advisor sem findings. Restam apenas indicadores INFO de índices sem uso, esperado antes de existir carga real.

## Bootstrap inicial ainda pendente
No momento não há usuários Auth nem superadministradores globais. A pessoa autorizada deve primeiro criar sua própria conta em `/cadastro`. Depois, o bootstrap controlado está documentado em `supabase/operations/bootstrap_first_platform_admin.sql`. Não há promoção automática em cadastro público.

## Verificação manual necessária
Confirmar no Supabase Dashboard → Project Settings → API → Exposed schemas que `app_auth` não está listado. A configuração da lista de schemas expostos é da API e precisa de confirmação no painel.

## Fora do escopo
Fornecedores, documentos, PDFs, assinatura eletrônica, Google Drive, cobrança e VPS permanecem para fases posteriores.
