# Implantação da Equipe de Suporte

Este roteiro acompanha a funcionalidade de suporte técnico por organização. Ele separa a preparação versionada da aplicação no Supabase SMS2.

## Situação de preparação

- Código da interface e da Edge Function versionado em `feat/platform-support-delivery`.
- Painel Master com convite, equipe, atribuições e permissões por Secretaria.
- Central técnica com motivo obrigatório, sessão temporária de 60 minutos e encerramento.
- Conta técnica independente de Administrador Master e de usuário municipal.
- Acesso limitado ao módulo Fornecedores, conforme a atribuição.
- Sem permissão de excluir ou inativar fornecedor.
- Auditoria de convites, ativações, alterações de atribuição, sessões e operações.
- Migrations executadas em banco Supabase local descartável; 41 testes pgTAP passaram.
- Build, testes unitários, TypeScript, ESLint e formatação aprovados no CI.
- Nenhuma migration foi aplicada ao projeto SMS2 por este trabalho; nenhum usuário técnico foi criado e nenhuma Edge Function foi publicada.

## Ordem das migrations novas

O histórico observado no SMS2 terminava em `20261108211206_guard_contract_amendment_value_and_dates`. As migrations abaixo estão ordenadas para a próxima aplicação:

1. `20261109150000_apply_commercial_guards_after_operational_tables.sql`
2. `20261109160000_platform_support_team_and_scoped_sessions.sql`
3. `20261109161000_complete_procurement_relations_and_amendment_trigger.sql`
4. `20261109162000_revalidate_platform_support_assignments.sql`
5. `20261109162100_preserve_supplier_permission_path.sql`
6. `20261109163000_support_invitation_activation_and_session_context.sql`
7. `20261109164000_harden_support_lifecycle_and_data_minimization.sql`
8. `20261109165000_enforce_support_identity_separation.sql`
9. `20261109166000_reconcile_tenant_row_identity_helper.sql`

A migration `20261109166000` é uma reconciliação forward-only do helper de identidade do tenant para ambientes que já possuem histórico de migrations anterior. Em instalações novas, o helper também é criado antes dos triggers da Fase 5.2.

## Preflight obrigatório no SMS2

Antes de qualquer execução em produção:

1. Conferir no painel que o projeto destino é `rwbbznqtocunzrpcvjvk` (SMS2).
2. Fazer e verificar um backup válido e, preferencialmente, confirmar restauração em projeto separado.
3. Executar `supabase migration list --linked` e comparar a versão remota com o histórico conhecido. Não executar sobre outro projeto ou branch.
4. Confirmar que as migrations de base até `20261108211206` constam como aplicadas.
5. Revisar o diff SQL da release e confirmar que não há operações de seed de usuários, tenants ou dados operacionais.
6. Usar primeiro um projeto de homologação separado para validar o fluxo completo com um Master de teste, uma Secretaria de teste e um e-mail de teste.

As correções em arquivos de migrations antigas (Fase 4, Fase 5.1 e capacidade/convites) corrigem a instalação limpa. Como essas versões já constam como aplicadas no histórico do SMS2, não se deve tentar reaplicá-las, reparar o histórico ou fazer reset em produção. As novas migrations acima complementam o schema existente.

## Aplicação das migrations

Somente depois do preflight e da aprovação explícita da janela de implantação:

```bash
supabase migration list --linked
supabase db push --linked
supabase migration list --linked
```

O resultado deve mostrar as versões novas como aplicadas e o histórico sem divergências. Não use `supabase db reset` no projeto remoto. Não use `migration repair` para forçar alinhamento sem diagnóstico e plano de recuperação.

## Publicação da Edge Function de convite

O convite de suporte usa uma nova Edge Function:

`supabase/functions/invite-platform-support-agent/index.ts`

A configuração `verify_jwt = true` está versionada em `supabase/config.toml`. O gateway exige JWT e a função consulta o usuário autenticado e chama `public.can_manage_platform_support_team()` no banco antes de usar o cliente administrativo. Essa autorização permite ao Administrador Master ou a um colaborador interno ativo com a permissão `support.team.manage` administrar técnicos e atribuições. Ela não permite iniciar sessão de suporte como Master; essa operação continua exclusiva do Administrador Master e do fluxo de técnico com atribuição ativa.

A publicação é uma etapa separada, depois de aplicar as migrations da Equipe de Suporte e a migration `20261109170000_platform_internal_staff_access.sql`, que cria a função de autorização compartilhada:

```bash
supabase functions deploy invite-platform-support-agent --project-ref rwbbznqtocunzrpcvjvk
```

O workflow automático existente do repositório publica somente as funções `invite-tenant-user` e `platform-billing-config`; portanto, ele não publica esta nova função. Não considerar o convite de suporte disponível antes de publicar e testar explicitamente `invite-platform-support-agent`.

O runtime da Edge Function deve ter as variáveis padrão do Supabase disponíveis, incluindo `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. A chave de serviço fica somente no servidor e nunca deve ser colocada no navegador ou no Git.

## Auth, e-mail e origens

Antes de convidar alguém:

- Configurar SMTP próprio no Supabase Auth para envio a destinatários externos.
- Configurar o Site URL e a allowlist de redirecionamento para o domínio efetivo.
- Para convite de suporte, permitir o retorno a `/redefinir-senha?convite=1&tipo=suporte` no domínio da aplicação.
- Configurar `APP_URL` para a origem canônica e `INVITE_ALLOWED_ORIGINS` para origens adicionais estritamente necessárias.
- Testar confirmação do e-mail e definição de senha com um endereço técnico novo.

Quando `APP_URL` está definida, a validação de origem deixa de aceitar automaticamente preview e localhost; somente a origem canônica e as origens explicitamente permitidas passam.

## Homologação funcional depois da implantação

1. Convidar uma conta de suporte com e-mail exclusivo, diferente de qualquer conta Master ou municipal.
2. Confirmar o e-mail e definir a senha pelo link recebido.
3. Verificar que o status muda de `invited` para `active` somente após a confirmação e o primeiro login.
4. Atribuir uma Secretaria com consulta, cadastro e/ou edição de fornecedores.
5. Iniciar uma sessão com motivo identificável; confirmar expiração prevista de 60 minutos.
6. Testar apenas as ações concedidas. Confirmar que exclusão, inativação, usuários, documentos, processos, contratos, cobrança e configurações não ficam acessíveis.
7. Suspender a atribuição durante a sessão e confirmar que a autorização é negada imediatamente.
8. Suspender o técnico e confirmar o encerramento de suas sessões.
9. Testar isolamento entre duas Secretarias e confirmar que um técnico não consulta organização sem atribuição ativa.
10. Conferir os eventos de auditoria e encerrar a sessão manualmente.

## Não executar automaticamente

Este pacote não cria técnicos, não envia convites, não publica Edge Functions e não aplica migrations no SMS2. Essas operações devem ocorrer numa janela própria, após backup, conferência do projeto, validação do SMTP e aprovação operacional.
