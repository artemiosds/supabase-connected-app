# Equipe Interna — estado e operação

## Estado atual no SMS2

Atualizado em 10/11/2026 após a implantação controlada.

- A migration `20261110121336_platform_internal_staff_access.sql` está aplicada.
- As cinco tabelas internas existem com RLS e FORCE RLS ativos.
- As tabelas internas não concedem SELECT, INSERT, UPDATE ou DELETE direto a `anon` ou `authenticated`; a interface utiliza RPCs protegidas.
- Existem cinco perfis padrão ativos e sete permissões no catálogo.
- A função Edge `invite-platform-staff` está ACTIVE, versão 1, com `verify_jwt=true`.
- A função Edge `invite-platform-support-agent` está ACTIVE, versão 3, com `verify_jwt=true`.
- Nenhuma conta interna foi criada ainda. Não cadastrar contas fictícias ou reutilizar a conta Master.
- A revogação segura de convites pendentes está preparada no PR #13, com migration `20261110144000`; ainda não está integrada ao `main` nem aplicada ao SMS2.
- Após integração, o cancelamento marca o perfil como `revoked`, preserva a identidade Auth e bloqueia a ativação pelo link antigo. O reenvio do mesmo e-mail não faz parte desta etapa.
- O histórico de migrações do SMS2 foi alinhado aos prefixos versionados no repositório.

A migração final de Equipe Interna está registrada no SMS2 como `20261110121336`. As migrações de suporte e proteção de identidade aplicadas nesta implantação são:

1. `20261110114727_apply_commercial_guards_after_operational_tables.sql`
2. `20261110115500_platform_support_team_and_scoped_sessions.sql`
3. `20261110115627_complete_procurement_relations_and_amendment_trigger.sql`
4. `20261110115723_revalidate_platform_support_assignments.sql`
5. `20261110115818_preserve_supplier_permission_path.sql`
6. `20261110115937_support_invitation_activation_and_session_context.sql`
7. `20261110115954_harden_support_lifecycle_and_data_minimization.sql`
8. `20261110120237_enforce_support_identity_separation.sql`
9. `20261110120321_enforce_support_identity_separation.sql` (marcador da reexecução idempotente)
10. `20261110121323_enforce_support_identity_separation.sql` (marcador da reexecução idempotente)
11. `20261110121329_reconcile_tenant_row_identity_helper.sql`
12. `20261110121336_platform_internal_staff_access.sql`

Os dois marcadores sem SQL adicional preservam as duas reexecuções idempotentes registradas no histórico remoto; o SQL efetivo de proteção de identidade está na versão `20261110120237`.

## Perfis padrão

| Perfil          | Acesso inicial                                                |
| --------------- | ------------------------------------------------------------- |
| Comercial       | Clientes, planos e métricas — consulta                        |
| Financeiro      | Resumo financeiro agregado, clientes e métricas — consulta    |
| Implantação     | Dados de clientes necessários à implantação — consulta        |
| Suporte interno | Clientes e gerenciamento da equipe técnica, quando autorizado |
| Auditoria       | Clientes, métricas e eventos de auditoria — consulta          |

O Master pode alterar permissões e criar perfis personalizados. A permissão `dashboard.view` é obrigatória. O catálogo contém somente operações já implementadas. Não conceder acesso a segredos, chaves de pagamento, alteração de planos ou operações administrativas globais.

## Antes de enviar os primeiros convites

A estrutura está criada, mas o fluxo de e-mail ainda precisa ser homologado no domínio real:

1. **SMTP próprio:** configurar um provedor de e-mail transacional no Supabase Auth. O SMTP padrão do Supabase é restrito a endereços da equipe do projeto e tem limite baixo; não é adequado para convidar funcionários externos em operação real.
2. **Domínio do aplicativo:** definir o secret `APP_URL` com a origem HTTPS publicada e, quando necessário, `INVITE_ALLOWED_ORIGINS` com origens adicionais específicas. Não usar curingas.
3. **Link de convite:** confirmar que o domínio de destino está permitido no Supabase Auth Redirect URLs e que a rota de redefinição de senha/aceite do convite está publicada.
4. **Homologação:** enviar um convite para um e-mail de teste controlado, confirmar recebimento, aceitar, definir senha e conferir a ativação.
5. **Teste de autorização:** verificar acesso permitido e negado, suspensão, reativação e trilha de auditoria.
6. **Cadastro real:** somente depois da homologação, convidar funcionários com e-mails individuais e atribuir o menor conjunto de perfis necessário.

Nunca envie senha SMTP, service-role key ou tokens pelo chat, GitHub ou código do navegador. Configure credenciais diretamente no painel seguro do provedor/Supabase.

## Backup e recuperação

**Não há backup restaurável verificado desta implantação.** O projeto SMS2 está no plano Free, sem backup diário automático ou PITR gerenciado. O repositório contém o workflow `.github/workflows/backup-sms2.yml`, mas ele só poderá gerar artefatos depois de configurar:

- Secret GitHub `SUPABASE_DB_URL`
- Secret GitHub `SUPABASE_SERVICE_ROLE_KEY`
- Variable GitHub `AGE_RECIPIENT`
- Variable GitHub `SUPABASE_BACKUP_ENABLED=true`

O backup lógico desse workflow inclui schema, dados das tabelas da aplicação, roles e arquivos do bucket privado indicado no próprio workflow. Não inclui identidades/senhas Auth, configurações do projeto, segredos de Edge Functions ou configurações SMTP. A chave privada age correspondente deve ficar offline e separada. O artefato não equivale a uma imagem integral restaurável do projeto; testar restauração em projeto separado antes de depender dele.

## Segurança

- RLS e FORCE RLS nas tabelas internas, sem permissões diretas de tabela para clientes.
- RPCs com `SECURITY DEFINER`, `search_path` fixo e autorização interna por identidade e perfil.
- Contas internas separadas de `platform_admins`, `platform_support_agents` e `tenant_memberships`.
- Convites começam como `invited`; a ativação depende de e-mail confirmado e identidade correspondente.
- Suspensão e alteração de perfil são verificadas no banco e auditadas.
- Financeiro vê somente resumos agregados; não vê credenciais privadas de cobrança.
- Suporte interno pode gerenciar técnicos quando recebe `support.team.manage`, mas não pode abrir sessão de suporte Master.

O Security Advisor também aponta a proteção contra senhas vazadas como desativada. No plano Free essa funcionalidade não está disponível; o Supabase documenta disponibilidade a partir do Pro. Avaliar upgrade antes de colocar o SaaS em operação com equipe externa.

## CI e código

O código está no `main`. A validação de aplicação e a formatação passaram após a integração. O CI de banco completo (reset local e testes pgTAP) passou no commit de validação anterior à conciliação de nomes, com o mesmo conteúdo SQL; a última execução após a simples renomeação dos arquivos ficou aguardando a inicialização do contêiner Supabase no GitHub Actions.

## Rollback

Não apagar tabelas nem registros de colaboradores após começar a usar o recurso. Em caso de problema, suspender a conta pela função administrativa, preservar os eventos de auditoria e corrigir por migration forward-only. Não executar reset remoto ou rollback destrutivo no SMS2.
