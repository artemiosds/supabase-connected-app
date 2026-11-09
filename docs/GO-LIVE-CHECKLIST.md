# Checklist de liberação do SaaS — Gestão de Fornecedores da Saúde

Este documento é o critério de **GO / NO-GO** antes de colocar a plataforma em uso real por Secretarias. Estrutura de banco e CI verdes não substituem homologação autenticada, restauração testada, revisão jurídica e configuração de serviços externos.

## Situação técnica conferida em 09/11/2026

- Supabase SMS2: **47 migrations registradas**; última 20261108211206_guard_contract_amendment_value_and_dates. As 47 versões estão sincronizadas com 47 arquivos SQL no GitHub.
- **24 tabelas públicas da aplicação com RLS**; **13 tabelas com FORCE RLS**; 18 permissões cadastradas.
- Administrador Master ativo e confirmado; há dois usuários Auth no total.
- Banco sem Secretarias, vínculos municipais, fornecedores, convites, documentos, processos, itens/cotações, orçamento, contratos, aditivos ou arquivos GED. Cinco modelos globais existem no catálogo, mas nenhum está instalado numa Secretaria.
- GED gfs-private-documents: bucket privado, limite 20 MiB, PDF/DOC/DOCX/XLS/XLSX/JPG/PNG; ainda sem objetos.
- Cobrança: cadastro de conta e armazenamento de credenciais no Vault preparados, mas zero integrações cadastradas e payments_enabled=false. Nenhum adaptador de pagamento está ativo.
- Nova RPC de processo cria processo e 11 itens padrão do checklist numa transação. Um teste controlado confirmou 11 itens, rejeição de título inválido sem processo parcial e ROLLBACK completo. A RPC de seleção de cotação inclui frete no custo unitário de referência e foi testada com duas cotações; o custo unitário estimado foi R$ 20,00 (R$ 40,00 totais com frete ÷ 2 unidades), e o total do item foi R$ 40,00. A troca de referência preservou exatamente uma cotação selecionada. Aditivos testados: acréscimo R$ 20 → total R$ 120; supressão R$ 30 → total R$ 90; supressão acima do saldo, sinal errado e prorrogação sem extensão foram bloqueadas.
- Cliente Supabase genérico dbFase3 removido; telas de Processos e Contratos usam o cliente tipado. O parser de valores monetários brasileiros/internacionais é compartilhado e tem testes de formatos e rejeição de entradas inválidas.
- Na sequência de release, **Validate application #229** passou no commit `475416eada470da8d47d86731b09f89b68040690` ([GitHub Actions](https://github.com/artemiosds/supabase-connected-app/actions/runs/42555328009)) e **Format procurement module #111** passou no mesmo commit ([GitHub Actions](https://github.com/artemiosds/supabase-connected-app/actions/runs/42555327981)). Esses workflows cobrem testes automatizados, build, TypeScript, lint e formatação; não equivalem à homologação autenticada no navegador.
- Smoke test transacional validou fornecedor, processo/checklist atômico, item, cotação, dotação, contrato, aditivo, documento, modelo, documento gerado, assinatura simples e convite/limite. Todos os dados foram revertidos com ROLLBACK.
- A rotina Encrypted SMS2 backup não possui execução registrada; nenhum artefato criptografado ou restore foi comprovado.
- Duas Edge Functions estão ativas: `invite-tenant-user` v6 e `platform-billing-config` v4. Não há Edge Function de alertas de vencimento nem OAuth/sincronização Drive implantados.
- `pg_cron` e `pg_net` não estão instalados no projeto; `cron.job` não existe. Nenhum agendamento de alertas foi comprovado.
- A branch `main` está sem proteção e sem status checks obrigatórios. O workflow de formatação foi convertido para `prettier --check`, sem commit/push automático, e agora também roda em Pull Requests; ainda falta configurar a proteção da branch no GitHub.
- Security Advisor: um aviso `auth_leaked_password_protection` (proteção contra senhas vazadas desativada). Health Advisor sem alertas. Performance Advisor: 56 índices `unused_index` em nível INFO; não remover sem dados reais e benchmark.

## Bloqueadores antes de produção

### 1. Identidade, Auth e e-mail
- [ ] Escolher e configurar provedor SMTP com domínio verificado.
- [ ] Configurar SPF, DKIM e DMARC no domínio remetente.
- [ ] Configurar Supabase Auth Site URL e allowlist de URLs de redirecionamento.
- [ ] Configurar APP_URL e INVITE_ALLOWED_ORIGINS na Edge Function para o domínio real.
- [ ] Testar cadastro, confirmação, recuperação de senha, convite, definição de senha, aceite, revogação e expiração com endereços controlados.
- [ ] Definir política de senha com comprimento mínimo de pelo menos 8 caracteres e requisitos adequados.
- [ ] Confirmar no plano e nas opções atuais do projeto como habilitar a proteção contra senhas vazadas (`auth_leaked_password_protection`) e aplicá-la; não assumir upgrade ou custo sem aprovação.

### 2. Onboarding e isolamento municipal
- [ ] Criar uma Secretaria de homologação com dados fictícios pelo fluxo normal de provisionamento.
- [ ] Confirmar administrador municipal por e-mail.
- [ ] Habilitar somente os módulos contratados e atribuir permissões necessárias.
- [ ] Criar segunda Secretaria de teste, com usuário e papel distintos.
- [ ] Comprovar isolamento de fornecedores, documentos, processos, itens, cotações, orçamento, contratos, aditivos, GED e auditoria.
- [ ] Testar bloqueio por Secretaria suspensa, bloqueio comercial, módulo desabilitado e limite de usuários.
- [ ] Testar reservas de convites e operações simultâneas no limite do plano.
- [ ] Executar o fluxo num navegador autenticado, não apenas por SQL ou CI.

### 3. GED, compras e documentos
- [ ] Fazer upload e download de PDF e de cada tipo de arquivo permitido com usuário municipal.
- [ ] Confirmar URLs assinadas temporárias, arquivo privado, bloqueio após arquivamento e isolamento entre duas Secretarias.
- [ ] Testar fornecedor, certidões, vencimentos e arquivamento.
- [ ] Cadastrar itens, pelo menos três cotações, selecionar uma referência, vincular dotação e conferir cálculos.
- [ ] Instalar e personalizar DFD, ETP, Mapa de Análise de Riscos, Matriz Contratual de Alocação de Riscos e TR.
- [ ] Conferir snapshots, versionamento, campos obrigatórios, impressão e auditoria.
- [ ] Testar contratos e aditivos de prazo e valor, inclusive limites e autorização.
- [ ] Decidir se PDF server-side e armazenamento das vias finais são obrigatórios para o contrato comercial.
- [ ] Decidir qual nível de assinatura é necessário. A assinatura atual é eletrônica simples e não ICP-Brasil.

### 4. Backup, segurança e continuidade
- [ ] Gerar identidade age e guardar a chave privada offline; cadastrar somente a chave pública em AGE_RECIPIENT.
- [ ] Cadastrar SUPABASE_DB_URL e SUPABASE_SERVICE_ROLE_KEY como GitHub Secrets.
- [ ] Executar manualmente Encrypted SMS2 backup e conferir dump, Storage, criptografia, artefato e hash.
- [ ] Descriptografar o artefato com a identidade privada correspondente e listar o TAR.
- [ ] Restaurar em projeto Supabase separado e validar schema, dados, Auth reconstruído, papéis, bucket, políticas, login e downloads GED.
- [ ] Somente após o teste, definir SUPABASE_BACKUP_ENABLED=true para habilitar o agendamento semanal.
- [ ] Definir estratégia adicional para Auth identities/passwords, configuração do projeto, secrets, SMTP, funções, logs e recuperação integral; o dump lógico exclui schemas gerenciados Auth/Storage.
- [ ] Definir retenção, responsável, monitoração, RPO/RTO e procedimento de incidente.
- [ ] Avaliar upgrade Supabase para backups diários gerenciados e proteção contra senhas vazadas; nenhum upgrade foi feito.

### 5. Cobrança, LGPD e operação
- [ ] Escolher gateway (Mercado Pago, Stripe ou outro) e abrir conta comercial.
- [ ] Definir planos, preços, trial, limites, tributos, faturas, cancelamento, estorno, inadimplência e conciliação.
- [ ] Implementar adaptador do gateway, validação de credenciais, webhooks assinados, idempotência, retentativas, logs e conciliação.
- [ ] Testar em Sandbox antes de permitir ativação real de pagamentos.
- [ ] Definir controlador e operador de dados, finalidades, bases legais, retenção, direitos dos titulares e resposta a incidentes.
- [ ] Revisar termos de uso, privacidade, contrato de tratamento de dados e cláusulas com cada município com assessoria jurídica.
- [ ] Definir suporte, SLA, canal de incidentes, monitoramento e continuidade.

### 6. Infraestrutura e publicação
- [ ] Definir domínio oficial e DNS.
- [ ] Configurar TLS, redirects Auth, CORS/origens e secrets de produção.
- [ ] Separar ambientes de homologação e produção.
- [ ] Definir atualização, janela de manutenção, rollback e política de release.
- [ ] Fazer validação visual e funcional autenticada no domínio real.
- [ ] Aprovar formalmente o GO para produção após concluir os testes.

## Critério de decisão

**NO-GO:** qualquer item obrigatório acima sem evidência, especialmente SMTP, backup restaurável, isolamento entre duas Secretarias, GED, cobranças, termos/contratos, domínio e homologação autenticada.

**GO controlado:** somente após concluir segurança, backup, onboarding, GED e conformidade e uma Secretaria piloto aprovar a operação.

## Limites conhecidos do backup

O workflow do repositório exporta schema, dados e roles dos schemas da aplicação, além dos objetos do bucket GED, e criptografa o pacote com age. O Supabase CLI exclui os schemas gerenciados auth e storage; portanto, o artefato não contém senhas/identidades Auth, metadados de Storage, configurações completas do projeto, secrets de Edge Functions, SMTP nem logs gerenciados. Não é backup integral ou ponto-no-tempo do projeto. O procedimento está em docs/ROTINA-DE-BACKUP.md; ainda falta comprovar descriptografia e restauração em projeto separado.


## Próxima trilha de execução

Não reconstruir tabelas nem reiniciar as Fases 1 e 2. A sequência operacional, dependências externas e critérios de aceite estão detalhados em [docs/PLANO-EXECUCAO-INTEGRACOES-E-HOMOLOGACAO.md](PLANO-EXECUCAO-INTEGRACOES-E-HOMOLOGACAO.md). A liberação permanece NO-GO até evidência de Auth/SMTP, duas Secretarias isoladas, GED autenticado, backup restaurado, E2E no navegador e requisitos comerciais/jurídicos.
