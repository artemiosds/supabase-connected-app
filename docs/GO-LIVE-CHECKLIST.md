# Checklist GO / NO-GO — Gestão de Fornecedores da Saúde

## Preparação do Assistente de IA por Secretaria — 22/11/2026

- Implementação integrada à `main` no commit `b50245ff96e94b035e66bf175524d0290f6a2a36`. O Administrador Master ativo (`platform_admins`) é o único perfil autorizado a configurar o provedor global e habilitar capacidades por Secretaria.
- Migration `20261122190000_platform_ai_configuration` aplicada ao SMS2 e reconciliada com o timestamp versionado. Tabelas `platform_ai_configuration` e `tenant_ai_settings` estão com RLS habilitada e forçada; sem privilégios de leitura para `anon`/`authenticated`, acesso operacional somente por `service_role`. Chave de API armazenada exclusivamente no Supabase Vault.
- Edge Functions `platform-ai-configuration` e `primus-ai` estão ativas com JWT obrigatório. Validação pós-aplicação confirmou as RPCs de segredo sem execução por `anon`/`authenticated` e executáveis por `service_role`.
- CI pós-merge aprovada no commit: [validação completa](https://github.com/artemiosds/supabase-connected-app/actions/runs/45080113361), [E2E multi-tenant](https://github.com/artemiosds/supabase-connected-app/actions/runs/45080113417) e [formatação](https://github.com/artemiosds/supabase-connected-app/actions/runs/45080113372).
- **Pendente de ação humana:** nenhuma chave/modelo foi configurada. O Administrador Master deve acessar **Admin Master > IA**, cadastrar a credencial aprovada pelo órgão, testar a conexão, validar privacidade/retenção com o provedor, então ativar globalmente e liberar capacidades por Secretaria mediante aceite institucional. Nenhum dado fictício foi inserido no SMS2.
- Capacidades iniciais: assistente administrativo, rascunhos DFD/ETP/TR/mapa de riscos, análise das cotações existentes, leitura de metadados de certidões, acompanhamento contratual, apoio ao recebimento, organização de tarefas e rascunhos de e-mail. Sem OCR de arquivos privados, pesquisa automática no PNCP/Compras.gov.br, gravações operacionais, aprovações, assinaturas ou envio automático de e-mail. Ver [procedimento de IA](IA-OPERACAO-E-SEGURANCA.md).

## Homologação técnica do mapa — 19/11/2026 (CI aprovada)

- Código validado em `3887007bf64d2754df43d86b64fce253324880b6`. [E2E 44527588758](https://github.com/artemiosds/supabase-connected-app/actions/runs/44527588758) concluiu a gravação normativa com auditoria, aprovação do preço, criação do mapa pelo motor nativo, revisão por usuário distinto, assinatura simples, A4 paisagem e SHA-256 do PDF arquivado. O job de aplicação e o de segurança do banco também passaram: [44527588706](https://github.com/artemiosds/supabase-connected-app/actions/runs/44527588706).
- Foram corrigidos três bloqueios encontrados pelo E2E: identidade da auditoria do processo, conflito da geração nativa com o validador de modelos e leitura restrita do status de aprovação pela função de assinatura.
- **Rollout pendente:** 118 migrations no repositório e 115 no SMS2. Aplicar exclusivamente as versões `20261119120941`, `20261119124309` e `20261119124921`, nesta ordem, após a prova de restauração e a janela de implantação. Não executar `db push` indiscriminado. A consulta somente leitura confirmou que as três correções ainda não estão presentes no SMS2.
- **Aceite institucional pendente:** responsável autorizado deve registrar enquadramento normativo e aprovação de preços de processo real, conferir a identidade visual e valores do mapa, submeter à revisão independente, assinar se autorizado e verificar o SHA-256 do PDF arquivado. Registrar processo, versão, data, responsável, evidência de integridade e decisão; não publicar dados pessoais ou segredos. Nenhum dado sintético foi gravado no SMS2.

O teste automatizado está aprovado; a liberação operacional permanece pendente dos gates de recuperação e aceite real.

## Complemento de homologação do mapa — 19/11/2026

- Corrigida a abertura do mapa na aba de documentos gerados e preservada a orientação A4 paisagem no GED. O cenário de navegador agora percorre validação normativa, aprovação do preço, aprovação documental por outro usuário, assinatura simples e conferência do SHA-256 do PDF final.
- O primeiro ensaio identificou um erro do gatilho de auditoria na gravação do enquadramento normativo. A migration incremental `20261119120941_fix_procurement_compliance_audit_identity.sql` corrige o identificador do evento para usar o processo. Validar na CI e programar a aplicação controlada no SMS2; não reaplicar a história existente.
- A homologação com documento oficial, norma aplicável e responsáveis reais do órgão continua pendente de aceite humano. A execução automatizada usa exclusivamente dados sintéticos em ambiente descartável.

## Atualização técnica — 19/11/2026

**Decisão operacional: PENDENTE DE HOMOLOGAÇÃO.** O mapa comparativo tem cotação com rastreabilidade da fonte, frete rateado, seleção de referência, aprovação do preço por item, justificativa excepcional quando há menos de três preços e validação normativa por processo. A exportação é identificada como rascunho enquanto essas validações estiverem pendentes. O fluxo documental exige aprovação independente antes da assinatura eletrônica simples; o PDF final é armazenado no bucket privado e o download confere seu SHA-256. Isso não substitui o aceite jurídico e visual da Secretaria nem equivale a uma assinatura qualificada ICP-Brasil.

- Repositório `artemiosds/supabase-connected-app`, branch `main`: a correção do seletor de cotação no E2E está em `795a9f9862e4ac8c3d9cc8060d2abbb7cd86953d`.
- Migrations: **115 arquivos SQL locais e 115 versões registradas no SMS2**, com os mesmos identificadores na conferência somente-leitura. As quatro divergências históricas de nomes já estão reconciliadas. Nenhuma migration foi reaplicada e nenhum dado sintético foi inserido no SMS2.
- E2E autenticado com duas Secretarias, cotações, mapa e contrato: [run 44516988969](https://github.com/artemiosds/supabase-connected-app/actions/runs/44516988969) — aprovado em banco descartável. Formatação: [run 44516988924](https://github.com/artemiosds/supabase-connected-app/actions/runs/44516988924) — aprovada. Validação de aplicação (`tsgo --noEmit`, testes e build) e segurança do banco local: [run 44516988948](https://github.com/artemiosds/supabase-connected-app/actions/runs/44516988948) — ambos os jobs aprovados.
- A prova automatizada não cobre a aprovação do preço e a assinatura do mapa pela interface na mesma sessão; o banco contém regressões pgTAP para guardas de aprovação, contexto normativo, fingerprint da pesquisa e finalização de assinatura. A assinatura do arquivo oficial ainda depende de homologação com documento e atores reais.
- Pendente de ação do órgão: validar fontes e enquadramento legal do processo, aprovar os valores, conferir o PDF/DOCX com timbrado e colher assinatura/aceite por responsáveis autorizados. As demais frentes de e-mail, Drive opcional e restore continuam com os bloqueios operacionais descritos abaixo.

As seções anteriores são registros históricos; seus números de migrations, SHAs e status de CI não representam o estado de 19/11.

## Decisão operacional — 18/11/2026

**Pendente de homologação.** Base de código `e2d2725`. E2E de isolamento aprovado (run 44307307586); formatação aprovada (44307307564). Registrar o resultado do workflow 44307307620 separadamente.

- [ ] Documentos: validar modelo oficial com brasão, margens e rodapé. Conferir tags fragmentadas, campos ausentes e valores de 31+ itens no DOCX e PDF. O teste automatizado com 90 itens verifica multipaginação e dimensões da primeira página; a repetição visual do cabeçalho em cada continuação exige evidência adicional.
- [ ] E-mail: validar DNS e STARTTLS, enviar exatamente um convite em homologação e registrar pasta de entrega e perfil. Convite Supabase Auth e alertas da Edge Function usam transportes distintos.
- [ ] Drive opcional: obter consentimento drive.file, limitar o tenant de homologação a 1–3 elegíveis e comparar SHA-256 antes/Drive/depois. Alternativa: dispensa assinada pela Secretaria.
- [ ] Recuperação: ZIP do artefato 44107141257 e checksum interno verificados. Restaurar em destino local isolado, com fonte Auth que preserve UUIDs, validar vínculos, objetos privados e login. A chave age permanece sob custódia do órgão.

Registrar responsável, data, versão, evidência restrita e conclusão por frente. Não registrar segredos ou links temporários.


## Estado consolidado — 16/11/2026

**Decisão: NO-GO para produção e comercialização.** O projeto segue em homologação técnica. Não anunciar integrações, backup real ou envio de e-mail como operacionais sem evidência verificável.

### Repositório, banco e migrations

- Repositório: `artemiosds/supabase-connected-app`, branch `main`.
- HEAD atual: `44578d5aba8b58737c6705001b9cb6f880e5498e`.
- Supabase SMS2: projeto `rwbbznqtocunzrpcvjvk`.
- Reconciliação somente-leitura: **91 migrations aplicadas no SMS2 e 91 arquivos SQL locais**, com correspondência exata de todos os prefixos. As duas migrations de 16/11 foram alinhadas aos identificadores reais do banco (`20261116172306` e `20261116172323`), preservando o conteúdo SQL. Não reaplicar nem executar `db push` sem nova reconciliação.
- Nenhuma fixture sintética foi gravada no SMS2.

### CI — os três workflows passaram no mesmo HEAD

- Formatação: [run 43923011042](https://github.com/artemiosds/supabase-connected-app/actions/runs/43923011042) — sucesso.
- Validação completa: [run 43923010880](https://github.com/artemiosds/supabase-connected-app/actions/runs/43923010880) — sucesso.
- E2E autenticado de isolamento: [run 43923010973](https://github.com/artemiosds/supabase-connected-app/actions/runs/43923010973) — sucesso.
- Todos os três executados no mesmo SHA `44578d5aba8b58737c6705001b9cb6f880e5498e`. A correção do seletor do título de contrato foi validada sem remover cenários.

### Auditoria funcional de contratos e saldos

- A rota `src/routes/_authenticated/contratos.tsx` contém cadastro/edição de contratos e registro/histórico de aditivos.
- A migration `20261112123300_contract_arp_item_balances.sql` cria itens de contrato/ARP, ledger imutável de consumo/estorno, limites de saldo, validações, trilha de auditoria e RPCs protegidas.
- **Lacuna confirmada:** a rota de contratos não consulta `contract_items` nem `contract_item_movements`, não apresenta saldo por item e não oferece a interface de cadastro de itens, consumo ou estorno. Existe teste unitário de cálculo de saldo, mas isso não comprova operação pela interface. Portanto o gate de contratos/ARP ainda não está fechado.
- O formulário de aditivo oferece prorrogação, acréscimo, supressão e outro; os limites percentuais legais não estão codificados, deliberadamente, sem uma matriz normativa aprovada. Requer homologação jurídica/administrativa da Secretaria antes de automatizar limites.

### Segurança e operação

- Auditoria SQL registrada: 73 funções públicas `SECURITY DEFINER`, todas com `search_path` fixado; nenhuma executável por `anon`; 36 executáveis por `authenticated` exigem revisão individual da autorização interna. Não revogar permissões em massa.
- RLS habilitado nas tabelas públicas consultadas, mas requer testes completos de autorização por papel e operação.
- Proteção contra senhas vazadas continua desabilitada e precisa ser reavaliada antes da produção.
- Backup sintético em banco descartável não equivale a backup/restauração real do SMS2.
- Não foram comprovados envio real de e-mail, OAuth Google Drive nem cobrança por gateway.

### Bloqueios para encerramento

1. **Contratos e ARP:** implementar e testar interface de itens, saldos, consumos e estornos usando as RPCs existentes; validar limites financeiros, bloqueios e trilha de auditoria.
2. **Aditivos:** testar todos os tipos, concorrência, datas, histórico e efeitos sobre o valor; aprovar regra normativa aplicável a limites percentuais antes de automatizá-los.
3. **GED de fornecedores:** validar upload/download, URLs assinadas, MIME/tamanho, substituição, arquivamento, expiração e isolamento entre Secretarias.
4. **Convites e RBAC:** testar cadastro, convite, aceite, expiração, revogação, reenvio, suspensão/reativação e papéis com duas Secretarias.
5. **Backup/continuidade:** configurar credenciais e chave age fora do chat/repositório; executar backup criptografado real e restaurar em projeto isolado; verificar banco, Storage e recuperação complementar de Auth/configurações/segredos.
6. **E-mail:** verificar domínio, SPF/DKIM/DMARC, remetente, SMTP/Resend, segredos e URL; executar dry-run remoto e envio controlado autorizado; manter agendamento desabilitado até comprovar idempotência e entrega.
7. **Documentos oficiais:** homologar modelos DOCX anonimizados/autorizados, timbrado, brasão, Word/PDF, paginação e tabelas; obter aceite da Secretaria.
8. **Integrações:** homologar Google Drive OAuth por Secretaria e gateway/webhooks somente com provedores e credenciais definidos.
9. **LGPD e produção:** retenção, exportação/exclusão, incidentes, termos, privacidade, contrato, domínio/TLS, monitoramento, SLA, suporte, custos e plano de rollback.

**Resultado:** os testes automatizados estão aprovados no mesmo commit, mas o sistema permanece **NO-GO para produção/venda** até fechar os gates acima.

### Evidências automatizadas — aprovação e cancelamento visuais em `8ee4e17274e518c292d178f4d8e87a6b8ebfdbbb`

- **Validação, build, TypeScript, Deno, lint e segurança do banco descartável:** [run 43878865833](https://github.com/artemiosds/supabase-connected-app/actions/runs/43878865833) — jobs `validate` e `database-security` concluídos com sucesso no commit documental `f46258b`.
- **pgTAP:** 23 arquivos SQL, 423 verificações, resultado PASS. Inclui segurança multitenant, Storage privado, timbrado, workflow documental, outbox/idempotência de notificações e regras de contratação.
- **Vitest:** 22 arquivos, 136 testes aprovados. Inclui DOCX, importação, preenchimento de variáveis, timbrado e transporte simulado do Resend.
- **Formatação:** [run 43878865720](https://github.com/artemiosds/supabase-connected-app/actions/runs/43878865720) — sucesso no commit documental `f46258b`.
- **E2E autenticado:** [run 43878866355](https://github.com/artemiosds/supabase-connected-app/actions/runs/43878866355) — sucesso no commit documental `f46258b`, com duas Secretarias fictícias e contas `.invalid`. Valida isolamento de fornecedores, fontes DOCX privadas, timbrado e aprovação/cancelamento pela interface. Confirma a negação de criação pelo aprovador, estados sincronizados de cancelamento e ator no histórico. O ciclo de compras/contratos e o GED de documentos de fornecedores ainda não estão neste E2E.
- **Timbrado/brasão pela interface:** o mesmo E2E salvou para cada Secretaria uma configuração e um PNG sintético no bucket privado; verificou metadados, SHA-256 do download privado, bloqueio de leitura pública, acesso cruzado e limpeza de objeto órfão.
- **Notificações — dry-run:** 4 candidatos, 4 processados, 0 enviados, 0 falhas, 0 incertos. Nenhum e-mail real foi enviado.
- **Backup sintético:** pacote criptografado, checksum verificado, descriptografado e restaurado em PostgreSQL descartável. Isso **não é** backup real do SMS2 nem restauração de dados reais em outro projeto.

### Último estado remoto registrado do SMS2 e das funções publicadas

- Na última verificação registrada, as cinco Edge Functions estavam ACTIVE e o código publicado coincidia com o `main` daquele commit: `invite-tenant-user` v18, `platform-billing-config` v16, `invite-platform-support-agent` v9, `invite-platform-staff` v7 e `send-expiry-notifications` v9. A última usa `verify_jwt=false` e valida seu próprio segredo de cron.
- Contagem somente-leitura no SMS2: 1 Secretaria, 2 perfis; 0 fornecedores, contratos, documentos de fornecedor, processos, modelos instalados, fontes DOCX, registros de timbrado, documentos gerados, fluxos/eventos de aprovação e objetos no bucket privado.
- Bucket `gfs-private-documents`: privado, limite de 20 MiB. Nenhuma fixture usada pela CI foi gravada no SMS2.
- O terceiro usuário fictício recebe `org:view`, `documents:view`, `documents:approve` e `documents:update`, sem `documents:create`; a CI verifica aprovação e cancelamento sem permitir criação. O E2E autenticado concluiu a aprovação visual por outro usuário; isso cobre o fluxo sintético, não substitui homologação por usuários reais da Secretaria.
- Os workflows [backup real](https://github.com/artemiosds/supabase-connected-app/actions/runs/43717347094) e [envio agendado](https://github.com/artemiosds/supabase-connected-app/actions/runs/43744597699) foram `skipped` pelos controles de ativação. Nenhum backup real ou e-mail real foi produzido.

### Pendências que realmente bloqueiam o encerramento

1. **Backup real e recuperação:** configurar no GitHub Actions os segredos `SUPABASE_DB_URL` e `SUPABASE_SERVICE_ROLE_KEY`, além da variável `AGE_RECIPIENT`; manter a identidade privada age offline, fora do GitHub. Executar o backup criptografado do SMS2 e restaurar em banco/projeto isolado, verificando dados e objetos do GED. O pacote não cobre Auth gerenciado, configurações Supabase nem segredos de Edge Functions; documentar a recuperação complementar.
2. **E-mail real:** configurar Resend/SMTP, domínio e remetente verificados, SPF/DKIM/DMARC, `APP_URL` e o segredo de cron no Supabase e GitHub. Fazer primeiro dry-run remoto sem envio; depois teste controlado para endereço autorizado. Manter `EXPIRY_ALERTS_ENABLED` desligado até validar esse envio. Não ativar o agendamento diário antes disso.
3. **Homologação oficial de documentos:** receber modelos DOCX reais anonimizados, brasão/timbrado autorizado e exemplos aprovados pela Secretaria; comparar Word/PDF, margens, cabeçalho, rodapé, paginação, tabelas e recursos não suportados. Fixtures sintéticas não substituem esse aceite.
4. **Aprovação visual ponta a ponta:** coberta por E2E sintético na CI. Continua pendente homologar o fluxo com usuários e documentos reais da Secretaria.
5. **Aceite e integrações:** obter aceite formal da Secretaria; concluir a homologação de Google Drive OAuth e dos webhooks/gateway de cobrança antes de anunciar essas integrações como prontas.

**Resultado verificado em 16/11/2026:** `main` está no commit documental `f46258b`; o código de aplicação está no pai `8ee4e17`. Validação/segurança ([run 43878865833](https://github.com/artemiosds/supabase-connected-app/actions/runs/43878865833)), formatação ([run 43878865720](https://github.com/artemiosds/supabase-connected-app/actions/runs/43878865720)) e E2E autenticado ([run 43878866355](https://github.com/artemiosds/supabase-connected-app/actions/runs/43878866355)) passaram nesse head. A reconciliação somente leitura confirmou 89 migrations no SMS2 contra 91 no `main`; as duas pendentes estão identificadas no início deste checklist e não foram aplicadas. **O sistema permanece NO-GO para produção/venda** até concluir os gates operacionais: backup/restore real, entrega controlada de e-mail, documentos oficiais aprovados, cobertura navegador de compras/contratos e aceite formal.


---


> **Fotografia histórica de 12/11/2026.** Os números e pendências deste bloco foram substituídos pelo estado consolidado acima; mantidos apenas para rastreabilidade. SMS2 foi consultado somente para leitura; a CI mais recente é do commit `2a3570daef8d931f6bcf2a9e5c4e7ab033c9d51b`.
> - O schema `public` tem 38 tabelas, todas com RLS habilitada; 27 também usam FORCE RLS e existem 133 políticas. O histórico remoto registra 74 migrations até `20261112123300`. O repositório `main` tem 82 arquivos SQL e oito migrations futuras não aplicadas ao SMS2: fonte DOCX, timbrado por Secretaria, bloqueio de campos pendentes, guardas do workflow de contratação, FORCE RLS da fonte DOCX, cobertura de índices FK e remoção de políticas SELECT redundantes.
> - Há 1 Secretaria, 1 vínculo municipal, 2 perfis e 2 identidades Auth; não há fornecedores, documentos operacionais, processos ou contratos. O catálogo global contém 5 modelos.
> - Cinco Edge Functions estão ativas: `invite-tenant-user` v15, `platform-billing-config` v13, `invite-platform-support-agent` v6, `invite-platform-staff` v4 e `send-expiry-notifications` v3. Ativa não significa que e-mail real ou scheduler esteja homologado.
> - CI completo do commit `2a3570d` passou testes unitários, build, TypeScript, Deno, lint, formatação, aplicação das 82 migrations em Supabase descartável e regressões pgTAP ([run 43302243085](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243085); formatação [run 43302243137](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243137)).
> - O motor documental inclui DOCX original por versão, exportação Word, PDF por renderizador próprio, timbrado por Secretaria, bloqueio de campos pendentes e proteção contra DOCX ZIP excessivamente grande. O editor visual rico, E2E autenticado e homologação visual de modelos reais ainda não foram concluídos. Nenhum dado fictício foi escrito no SMS2 nem e-mail real enviado.
> - SMS2 continua sem `document_template_sources` e `tenant_document_branding`; nenhuma das oito migrations futuras foi aplicada. O importador DOCX também valida CRC e consistência do cabeçalho ZIP, e a tela Documentos descarta respostas antigas após troca de Secretaria. Integrações/configurações ainda pendentes: SMTP e agendamento de alertas, Drive OAuth, gateway/webhooks de pagamento, restore de backup em projeto separado, E2E e homologação autenticada com duas Secretarias. O estado permanece **NO-GO para venda/liberação comercial**.

**Verificação:** 12/11/2026
**Supabase:** SMS2, projeto `rwbbznqtocunzrpcvjvk`.

## Registro histórico — estado técnico de 10/11/2026

Os números e versões deste bloco são uma fotografia anterior. Para o estado atual, use o resumo verificado no início deste documento.

- 59 migrations aplicadas no SMS2. O `main` contém uma migration futura adicional `20261110143000`, ainda não aplicada.
- 32 tabelas públicas; RLS em 32; FORCE RLS em 21; 114 políticas.
- 1 Secretaria e 1 vínculo municipal ativo; 1 Master; 2 contas Auth.
- Equipe Interna: 5 perfis padrão, 7 permissões, 0 contas.
- Equipe de Suporte: 0 técnicos, 0 atribuições, 0 sessões.
- Edge Functions ativas com JWT: `invite-tenant-user` v12, `platform-billing-config` v10, `invite-platform-support-agent` v3, `invite-platform-staff` v1.
- 5 modelos globais; 0 modelos instalados na Secretaria.
- 0 fornecedores/documentos/processos/itens/cotações/dotações/contratos/aditivos/documentos gerados.
- Bucket GED `gfs-private-documents` privado, 20 MiB, PDF/DOC/DOCX/XLS/XLSX/JPG/PNG; sem objetos.
- `pg_cron`/`pg_net` não instalados. Não há envio agendado de vencimentos; apenas alertas visuais.
- Cobrança desabilitada; nenhum gateway operacional.
- Google Drive OAuth não implementado.
- PR #8 DOCX foi integrado e passou CI completo, incluindo reset de migrations e pgTAP em banco local descartável.
- PR #9 alertas visuais foi integrado e passou CI completo; cobre contratos e documentos de fornecedores, sem e-mail agendado.
- PR #10 contém migration de RLS explícito e índices no main, ainda não aplicada ao SMS2; PR #12 reforça as políticas como restritivas e adiciona cobertura pgTAP, aguardando CI.
- Não há backup com restore comprovado; domínio/publicação final ainda não confirmados.

## Gate 1 — Auth, equipe e e-mail
- [ ] SMTP transacional configurado com domínio próprio verificado.
- [ ] SPF/DKIM/DMARC publicados e verificados.
- [ ] Supabase Auth Site URL e Redirect URLs configurados.
- [ ] `APP_URL` e `INVITE_ALLOWED_ORIGINS` configuradas com origens HTTPS exatas.
- [ ] Homologar cadastro, confirmação, login, recuperação e convite municipal.
- [ ] Homologar convite/aceite/senha/suspensão/reativação da Equipe Interna e Suporte.
- [ ] Homologar o cancelamento de convite pendente e confirmar que link revogado não concede acesso, depois da reconciliação segura do histórico remoto de migrations.
- [ ] Definir e homologar reenvio/recuperação de convite expirado somente após a escolha do provedor SMTP e do fluxo de envio personalizado.
- [x] Implementado cancelamento/revogação de convite pendente. A tela também identifica expirados pela data; reenvio e contas Auth já existentes ainda dependem da configuração e homologação do provedor SMTP.
- [ ] Testar contas existentes, limites, concorrência, convites expirados e revogados.
- [ ] Rever política de senha e alerta de proteção contra senhas vazadas.

## Gate 2 — Duas Secretarias e isolamento
- [ ] Criar duas Secretarias de homologação pelo fluxo normal.
- [ ] Criar usuários e administradores diferentes em cada uma.
- [ ] Testar leitura/escrita cruzada em fornecedores, documentos, Storage, modelos, processos, cotações, orçamento, contratos, aditivos e auditoria.
- [ ] Testar tenant suspenso, bloqueio comercial, módulo desativado e permissões insuficientes.
- [ ] Validar no navegador autenticado, não apenas por SQL/CI.

## Gate 3 — GED, modelos e documentos
- [ ] Testar upload/download autenticado, URLs assinadas, expiração e bloqueio após arquivamento.
- [ ] Testar isolamento do Storage entre tenants.
- [ ] Testar MIME, tamanho acima de 20 MiB, arquivo inválido e substituição.
- [ ] Homologar importação TXT/MD/DOCX e DOCX original por versão: parágrafos, estilos, tabelas, cabeçalho/rodapé, placeholders fragmentados e linhas repetíveis.
- [ ] Testar edição e restauração de versões; confirmar que editar texto desvincula o original e que metadados/restauração preservam a fonte quando aplicável.
- [ ] Testar prévia e lista de campos pendentes; confirmar bloqueio de envio à aprovação para `[PREENCHER: ...]`, `[CAMPO NÃO CONFIGURADO: ...]` e `{{...}}`.
- [ ] Homologar brasão, cabeçalho, rodapé, margens e paginação por Secretaria; comparar Word/PDF e verificar avisos/bloqueios de recursos não suportados.
- [ ] Definir retenção, PDF server-side e nível jurídico de assinatura.

## Gate 4 — Processos e contratos
- [ ] Testar processo/checklist atômico.
- [ ] Testar itens e três cotações, frete, seleção de referência e dotações.
- [ ] Testar contrato, aditivos de prazo/valor, limites e autorização.
- [ ] Validar auditoria, isolamento e desempenho com carga representativa.

## Gate 5 — Alertas e Drive
- [x] Integrar PR #9 de alertas visuais — concluído; não equivale ao envio programado de e-mails.
- [ ] Definir regras, antecedência, destinatários, frequência, fuso e idempotência.
- [x] Código da Edge Function de alertas e workflow agendado existem. [ ] Configurar secrets e regras; comprovar envio idempotente antes de habilitar o schedule.
- [ ] Implementar OAuth Drive por Secretaria, tokens protegidos, refresh e revogação.
- [ ] Manter GED Supabase como fallback até homologação do Drive.

## Gate 6 — Backup e continuidade
- [ ] Gerar chave age e manter a chave privada offline.
- [ ] Configurar GitHub Secrets e variables exigidas pelo workflow.
- [ ] Executar backup manual, conferir dump, Storage, hash e criptografia.
- [ ] Descriptografar e restaurar em projeto separado.
- [ ] Validar schema, RLS, funções, Auth reconstruído, login e download GED.
- [ ] Documentar RPO/RTO, retenção, responsáveis e recuperação.
- [ ] Só então habilitar agendamento automático.

O backup lógico não é backup integral: não inclui senhas/identidades Auth, configuração completa do projeto, secrets das Edge Functions e SMTP.

## Gate 7 — Comercial e produção
- [ ] Escolher gateway, conta comercial, planos, preço, trial, limites, tributos, inadimplência e cancelamento.
- [ ] Implementar adaptador e webhooks assinados/idempotentes.
- [ ] Testar em Sandbox; manter pagamento real desativado até aprovação.
- [ ] Revisar termos, privacidade, DPA/LGPD e contrato com assessoria jurídica.
- [ ] Definir domínio, DNS, TLS, ambientes, monitoramento, SLA, suporte e incidentes.
- [ ] Proteger `main` e exigir CI.
- [ ] Publicar frontend no domínio oficial, testar E2E e obter aceite do piloto.

## Critério
**NO-GO** enquanto SMTP, isolamento entre duas Secretarias, GED autenticado, backup restaurado, E2E, domínio, cobrança e jurídico estiverem sem evidência.  
**GO controlado** somente após os gates concluídos e aceite formal do piloto.

## Atualização de implantação — 10/11/2026, conferência direta

Esta atualização prevalece sobre os retratos anteriores deste documento.

- As quatro migrations pendentes foram aplicadas ao SMS2: políticas restritivas internas, revogação de convites, sete índices de FKs e outbox de alertas.
- SMS2 agora registra 63 migrations. A outbox existe, força RLS e não permite leitura nem claim pelo papel authenticated; service_role pode executar claim.
- Cinco políticas restritivas internas, sete índices e ambas as RPCs de revogação foram confirmados por consulta ao catálogo.
- O Supabase atribuiu versões de execução diferentes das versões dos arquivos. A reconciliação do histórico foi bloqueada pela revisão automática e NÃO foi executada. Não executar db push indiscriminadamente.

| Versão do arquivo | Versão registrada no SMS2 |
| --- | --- |
| 20261110143000 | 20261110180336 |
| 20261110144000 | 20261110180349 |
| 20261110150000 | 20261110180400 |
| 20261110151000 | 20261110180414 |

A baseline 20261106194000 também continua sem versão correspondente no histórico remoto; avaliar equivalência antes de qualquer reparo.

Cinco Edge Functions estavam ativas na auditoria, incluindo send-expiry-notifications. Sua dependência de banco foi implantada nesta etapa; envio efetivo, secrets e scheduler ainda não foram homologados. O CI do commit 9dbf29f passou build, testes, tipos, lint e regressões de banco local. A verificação desta implantação foi de catálogo/permissões; não substitui E2E autenticado.

Continuam pendentes: reconciliação do histórico, configuração e entrega de e-mail, homologação com duas Secretarias, GED no navegador, backup/restauração em ambiente separado, domínio/publicação e requisitos comerciais. Nenhum e-mail foi enviado nem dado operacional de teste persistido nesta etapa. NO-GO comercial permanece.


## Atualização de código — 12/11/2026

- [x] Exportação gerencial CSV e XLSX nativo estruturada no repositório; PDF gerencial via impressão.
- [ ] Conferir XLSX e PDF visualmente em navegador/Excel real com perfis e duas Secretarias.
- [x] CI do commit `9f2dc56` aplicou migrations em banco descartável e passou pgTAP.
- [ ] Homologar rascunhos Word/PDF no navegador e a fidelidade dos modelos DOCX importados.


## Modelos Word privados — 12/11/2026

- [x] Código e migration versionada para DOCX original por versão, guardado no bucket privado e protegido por RLS/Storage.
- [ ] Publicar a migration no SMS2 somente após reconciliar o histórico e revisar permissões de produção.
- [ ] Confirmar com perfis reais: MASTER, DIRETOR, membro sem permissão e duas Secretarias; importar, editar, exportar Word, baixar PDF e verificar a aparência.
- [ ] Configurar brasão/timbre oficial e validar documento final com equipe jurídica. PDF gerado no navegador ainda não reproduz imagens e tabelas complexas do DOCX original.


## Bloqueio de implantação de migrations — 12/11/2026

- [x] Comparadas 68 versões remotas e 75 migrations da `main`; sete aliases mapeados e SQL confrontado.
- [ ] Comprovar equivalência completa da baseline sem versão, restaurar backup em projeto isolado e simular reparo de histórico. Ver `docs/RECONCILIACAO-MIGRATIONS-SMS2.md`.
- [ ] Só depois de revisão e autorização, publicar as seis migrations pendentes no SMS2 e homologar por perfil e Secretaria.


## Atualização do motor documental — 12/11/2026

- Código em `main`: preservação do DOCX original por versão, recuperação ao reabrir/restaurar, PDF gerado pelo renderizador próprio, timbrado configurável por Secretaria e bloqueio de campos pendentes antes da aprovação.
- Migrations futuras no repositório: `20261112124000`, `20261112124500` e `20261112125000`. Todas passaram por aplicação e testes SQL em banco descartável; nenhuma foi aplicada ao SMS2.
- O editor ainda é textual. A edição do texto descarta o DOCX original; editor visual rico, E2E autenticado, homologação visual de modelos reais e restauração de backup continuam pendentes.
- **NO-GO** permanece até concluir o Gate 3 e os demais gates.


## Atualização de validação — 12/11/2026, commit `49dd493e6be34b8e143831b46c17861045474d76`

- [x] Corrigida a regex de UUID na política de exclusão de DOCX órfão.
- [x] CI completo aprovado no commit: validação geral e segurança de banco descartável, incluindo aplicação das migrations e regressões pgTAP ([run 43280660261](https://github.com/artemiosds/supabase-connected-app/actions/runs/43280660261)); formatação aprovada ([run 43280660696](https://github.com/artemiosds/supabase-connected-app/actions/runs/43280660696)).
- [x] Revisão estática do salvamento e restauração do DOCX: falhas de upload/vínculo geram aviso explícito de salvamento parcial.
- [ ] E2E autenticado para upload, falha parcial, retry, restauração, limpeza de órfãos e acesso entre duas Secretarias.
- [ ] Homologação visual com DOCX oficiais anonimizados, brasões e timbrados reais.
- [ ] Backup/restauração em projeto isolado e reconciliação segura do histórico de migrations do SMS2.

A execução anterior que falhou ocorreu antes do commit corretivo; não deve ser confundida com o CI posterior aprovado. Nenhuma migration foi aplicada ao SMS2 nesta validação. O estado comercial continua **NO-GO**.


## Atualização de validação — 12/11/2026, commit `4e79bf6accf1f5b50b4c648233bfcfdb4e84d108`

- [x] Testes do fluxo de aprovação documental ampliados de 4 para 13 verificações.
- [x] CI completo aprovado: aplicação, build, TypeScript, Deno/Edge Functions, lint, migrations em banco descartável e testes pgTAP ([validação 43284764341](https://github.com/artemiosds/supabase-connected-app/actions/runs/43284764341)); formatação aprovada ([43284764170](https://github.com/artemiosds/supabase-connected-app/actions/runs/43284764170)).
- [ ] Homologação com duas Secretarias e papéis distintos, incluindo envio, aprovação por outro usuário, devolução, campos pendentes e isolamento cruzado.
- [ ] Testes E2E de upload, falha parcial, recuperação/retry e restauração DOCX.
- [ ] Homologação visual com modelos oficiais anonimizados e brasões/timbrados reais.
- [ ] Backup/restauração em projeto isolado e reconciliação do histórico de migrations SMS2.

Os novos testes ampliam a proteção contra regressões, mas não substituem o cenário completo com dados sintéticos de duas Secretarias. SMS2 permanece intacto e a comercialização continua bloqueada.


## Atualização de validação — 12/11/2026, commit `a7bcd6073e7d960b99e54e1f694eccf9c0bae741`

- [x] CI completo aprovado no run [43288209117](https://github.com/artemiosds/supabase-connected-app/actions/runs/43288209117): `validate` e `database-security` concluídos com sucesso.
- [x] Migrations aplicadas em Supabase local descartável e regressões pgTAP aprovadas.
- [x] Teste de saldo de itens de contrato/ARP ajustado para o plano correto de 28 assertions.
- [x] Migration `20261112125500_guard_procurement_process_stage_transitions.sql` e teste estrutural de 22 verificações adicionados para proteger transições de etapa e checklist no banco.
- [x] Telas de processos e fornecedores receberam proteção contra respostas antigas de consultas após troca de Secretaria.
- [ ] Completar testes comportamentais de processo com fixtures sintéticas, sessões/papéis autenticados, checklist, transições permitidas e tentativas de pular/concluir indevidamente.
- [ ] Revisar a tela de documentos para impedir exibição transitória de dados da Secretaria anterior durante troca de tenant.
- [ ] Homologar GED/DOCX no navegador: upload parcial, retry, restauração/reanexo, falhas de metadata, limpeza de órfãos e downloads autenticados.
- [ ] Executar testes autenticados de isolamento com duas Secretarias e papéis distintos.
- [ ] Homologar backup e restauração em projeto Supabase separado, incluindo validação de Storage, RLS, funções e reconstrução de Auth.
- [ ] Concluir os demais gates deste checklist antes de produção ou comercialização.

O resultado verde da CI comprova validação automatizada do commit e aplicação/testes das migrations em banco descartável. Não comprova E2E visual/autenticado, recuperação de backup, configuração de serviços externos nem aceite do piloto. Nenhuma migration foi aplicada ao SMS2 nesta atualização.

**Estado final desta verificação: NO-GO para produção/venda.**


## Atualização de validação — 12/11/2026, commit `7a4fdaedfd61c0df305236332921ae844bb9aff6`

- [x] CI completo aprovado no run [43290173715](https://github.com/artemiosds/supabase-connected-app/actions/runs/43290173715): jobs `validate` e `database-security` verdes.
- [x] Todas as migrations do repositório aplicadas em Supabase local descartável e regressões pgTAP aprovadas.
- [x] Proteção do workflow de processos endurecida: trigger de processo cobre mudanças de ID/tenant/etapa/status e checklist não pode ser movido entre etapas após criação; teste pgTAP ampliado para 33 assertions, incluindo 9 verificações comportamentais com fixtures sintéticas em transação revertida.
- [x] Carregamento de documentos protegido contra respostas assíncronas de outra Secretaria, com limpeza dos dados anteriores e gate pelo tenant carregado.
- [ ] Completar testes comportamentais de processos com fixtures sintéticas e papéis autenticados.
- [ ] Completar E2E de DOCX/GED, isolamento autenticado de duas Secretarias e homologação visual com modelos oficiais anonimizados.
- [ ] Executar backup/restauração em projeto separado e validar Auth, Storage, RLS, funções e downloads.
- [ ] Concluir todos os demais gates antes de produção ou venda.

A CI comprova testes automatizados em banco descartável, não homologação visual/autenticada nem recuperação de backup. Nenhuma migration foi aplicada ao SMS2 nesta atualização. **NO-GO comercial permanece.**


## Atualização de validação — 12/11/2026, commit `cc4441c720c2cd73dd958d97d62717c19e899022`

- [x] CI completo aprovado no run [43292377124](https://github.com/artemiosds/supabase-connected-app/actions/runs/43292377124).
- [x] Formatação aprovada no run [43292377134](https://github.com/artemiosds/supabase-connected-app/actions/runs/43292377134).
- [x] Migrations aplicadas e pgTAP aprovado em Supabase local descartável, incluindo a migration `20261112133000_force_document_template_source_rls.sql`.
- [x] RLS forçada na tabela de originais DOCX e teste de segurança ampliado para 8 assertions.
- [x] Corrida de troca de Secretaria corrigida nos carregamentos, diálogos, histórico, restauração, salvamento e análise do DOCX.
- [x] Falha de limpeza de upload órfão agora é informada quando ocorre.
- [ ] Executar E2E autenticado de GED/DOCX (upload, download, falha parcial, retry, restauração e reanexo).
- [ ] Homologar visualmente modelos oficiais anonimizados e timbrados reais.
- [ ] Validar isolamento com duas Secretarias em sessão real, inclusive Storage.
- [ ] Testar backup e restauração em projeto Supabase separado, com validação de Auth, Storage, RLS, funções e downloads.
- [ ] Concluir todos os gates antes de produção ou venda.

A CI verde comprova a suíte automatizada e migrations em ambiente descartável, não comprova E2E visual/autenticado nem recuperação de backup. Nenhuma migration foi aplicada ao SMS2. **NO-GO comercial permanece.**


## Atualização de validação — 12/11/2026, commit `2a3570daef8d931f6bcf2a9e5c4e7ab033c9d51b`

- [x] Importador DOCX agora valida CRC-32 do XML principal e consistência do cabeçalho local com o diretório central do ZIP; testes cobrem conteúdo corrompido e cabeçalho divergente.
- [x] Ações assíncronas da tela Documentos (seleção/importação, URL temporária, cadastro/upload e arquivamento) descartam respostas após troca de Secretaria; upload ainda sem metadata é removido se o contexto mudar.
- [x] CI completo aprovado no run [43302243085](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243085): unit tests, build, TypeScript, Deno, lint, migrations em banco descartável e pgTAP.
- [x] Formatação aprovada no run [43302243137](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243137).
- [x] Todas as 82 migrations do repositório foram aplicadas em banco Supabase local descartável; SMS2 não recebeu migrations.
- [ ] E2E autenticado de upload/download, falha parcial, retry, restauração/reanexo e limpeza de órfãos.
- [ ] Homologação visual com DOCX oficiais anonimizados, incluindo timbrado, brasão, tabelas, paisagem e paginação.
- [ ] Isolamento autenticado e Storage com duas Secretarias e papéis distintos.
- [ ] Backup/restauração em projeto Supabase separado, com Auth, Storage, RLS, funções e downloads verificados.

**NO-GO para produção/venda permanece.** CI verde não substitui E2E, aceite visual, isolamento real ou teste de recuperação.


## Atualização de regressão comportamental — 12/11/2026, commit `44862e0749f52e70b7bf111b1dd611dc5593c094`

- [x] `procurement_process_workflow.test.sql` ampliado para 33 assertions: 24 verificações anteriores e 9 verificações comportamentais novas.
- [x] Fixtures sintéticas criam usuário, Secretaria, processo e checklist dentro de uma transação encerrada com ROLLBACK.
- [x] Cenários comportamentais: impedir avanço com checklist pendente; permitir avanço após conclusão; impedir salto de etapa; impedir pendência retroativa; impedir mudança de etapa da tarefa; impedir alteração do ID do processo; permitir conclusão somente na etapa final; impedir reabertura; impedir alteração do checklist após conclusão.
- [x] CI completo aprovado no run [43304160591](https://github.com/artemiosds/supabase-connected-app/actions/runs/43304160591): aplicação, build, TypeScript, Deno, lint, migrations em banco descartável e pgTAP.
- [x] Formatação aprovada no run [43304160274](https://github.com/artemiosds/supabase-connected-app/actions/runs/43304160274).
- [ ] E2E autenticado com dois tenants reais de teste, perfis diferentes e tentativas de acesso cruzado ainda pendente.

As fixtures são exclusivamente sintéticas e revertidas. A suíte comportamental não substitui a homologação autenticada entre duas Secretarias. SMS2 não foi alterado; NO-GO comercial permanece.


## Atualização de status — 13/11/2026

- [x] Commit `01d35ab49fe6750175b18ae2d5186c5fe2a460a6` corrige a corrida que poderia iniciar upload de DOCX após troca da Secretaria durante a consulta da origem existente.
- [x] CI integral do commit aprovado no run [43306515714](https://github.com/artemiosds/supabase-connected-app/actions/runs/43306515714), incluindo build, testes, TypeScript, Deno, lint, migrations em banco descartável e pgTAP.
- [ ] E2E autenticado do ciclo DOCX, falhas parciais/retry, duas Secretarias e Storage ainda não executado. Não há Playwright/Cypress configurado no repositório neste momento.
- [ ] Homologação visual de modelos reais anonimizados e backup/restauração em projeto isolado continuam pendentes.
- [ ] Aceite formal da Secretaria e auditoria funcional final continuam pendentes.

**NO-GO para produção/venda permanece.** SMS2 não recebeu migrations nem dados de teste nesta atualização.


## Registro histórico do Advisor remoto SMS2 — leitura de 13/11/2026 (antes das verificações mais recentes)

- [x] Histórico remoto consultado: 74 migrations, última `20261112123300`; as oito migrations futuras do repositório permanecem não aplicadas.
- [x] Advisor de saúde: nenhum finding.
- [ ] Advisor de segurança: 36 avisos de funções `SECURITY DEFINER` executáveis por `authenticated`. A regra do projeto exige revisão individual; não revogar em massa, pois várias são RPCs intencionais e devem validar autorização no corpo. Revisar especificamente as RPCs documentais e de suporte.
- [ ] Advisor de segurança: proteção de senha vazada do Supabase Auth está desabilitada; ativação depende de configuração Auth no painel e avaliação do impacto para os usuários.
- [ ] Advisor de performance: 6 FKs sem índice de cobertura, incluindo `generated_documents(template_id, tenant_id)`. A migration aditiva `20261112150000_complete_foreign_key_index_coverage.sql` contém os seis índices, mas ainda não foi aplicada ao SMS2.
- [ ] Advisor de performance: 7 conjuntos de políticas SELECT permissivas duplicadas, incluindo documentos/modelos/processos. A migration `20261112162000_remove_redundant_master_select_policies.sql` remove somente políticas redundantes cujo predicado Master já está incluído nas políticas principais; ainda não aplicada ao SMS2.
- [ ] Advisor também reporta 72 índices sem uso observado; não remover automaticamente, pois o projeto ainda tem baixo histórico de uso e vários índices protegem FKs/consultas futuras.

**Decisão:** findings foram registrados como itens de revisão e rollout, não como autorização para alterar o SMS2. Nenhuma migration, configuração Auth ou dado remoto foi alterado durante esta auditoria.


## Atualização de segurança e CI — 13/11/2026, commit `d2ce13fe2c9990d96a151d3d49e4ba660dac057d`

- [x] CI completo aprovado: validação [run 43417500383](https://github.com/artemiosds/supabase-connected-app/actions/runs/43417500383) — jobs `validate` e `database-security` concluídos com sucesso; formatação [run 43417500282](https://github.com/artemiosds/supabase-connected-app/actions/runs/43417500282) aprovada.
- [x] Novo teste pgTAP `security_definer_public_api.test.sql` adiciona sete guardas sobre a API SECURITY DEFINER exposta a `authenticated`: search_path vazio, ausência de EXECUTE para `anon`/PUBLIC e verificação de identidade/autorização.
- [x] Auditoria de leitura do SMS2: 36 funções SECURITY DEFINER acessíveis a `authenticated`; 36/36 fixam `search_path=""`, 0 concedem EXECUTE a `anon`, 0 herdam EXECUTE de PUBLIC e 0 não contêm referência a `auth.uid()` ou `app_auth.`.
- [x] Revisão de catálogo confirmou que as sete políticas Master redundantes repetem o predicado já presente nas políticas SELECT principais; as sete políticas restritivas comerciais permanecem separadas e intactas.
- [x] Consulta de índices confirmou ausência dos seis índices planejados no SMS2; a migration aditiva continua pendente e não foi aplicada.
- [ ] Completar testes comportamentais de RLS/Storage para fontes DOCX e timbrado por Secretaria, com duas identidades e tenants sintéticos.
- [ ] Completar cenários positivos e negativos do workflow documental, incluindo duas aprovações por atores distintos e isolamento cruzado.
- [ ] E2E autenticado, recuperação de upload DOCX, homologação visual e backup/restore em projeto isolado continuam pendentes.

Nenhuma migration, configuração Auth ou dado operacional foi alterado no SMS2 nesta etapa. Os avisos do Advisor não foram tratados como vulnerabilidades automáticas nem removidos em massa. Estado comercial permanece **NO-GO**.


## Homologação — teste individual de e-mail institucional (18/11/2026)

- [ ] Fazer **deploy controlado** da Edge Function `tenant-integration-settings` (e do módulo `_shared/test-email.ts`) após revisão. Antes do deploy, produção continua com a versão antiga (envio só ao e-mail do usuário logado).
- [ ] Em Configurações > Integrações e LGPD > E-mail institucional, salvar SMTP (endpoint em `SMTP_ALLOWED_ENDPOINTS`) ou Resend, informar um único destinatário autorizado e clicar em **Enviar 1 e-mail de teste**.
- [ ] Registrar o resultado exibido: **aceito pelo servidor**, **rejeitado** ou **incerto**. O servidor aplica intervalo mínimo de 60 s entre testes (`email_last_test_at`).
- [ ] Conferir manualmente a caixa de entrada/spam do destinatário e anotar pasta e cabeçalhos (SPF/DKIM/DMARC).

**Aceito ≠ entregue:** "aceito pelo servidor SMTP/provedor" só significa que o servidor recebeu a mensagem para encaminhar. A entrega na caixa depende de DNS, reputação e filtros do destinatário e só é comprovada pela conferência manual. "Incerto" (timeout/conexão interrompida) é persistido como `failed`, mas não deve ser repetido antes de conferir a caixa. O teste não aciona `send-expiry-notifications`, filas nem alertas; a auditoria grava apenas ação, resultado, provedor e destinatário mascarado.

## PCA por Secretaria — homologação do vínculo com o DFD

- [ ] Em base descartável, validar a migration `20261119190000_plan_annual_procurement_demands.sql` e os testes de processo.
- [ ] Em Processos > Plano de Contratações Anual, enviar demanda com dois itens de unidades diferentes. Conferir o exercício, o objeto, a justificativa e as quantidades antes da aprovação.
- [ ] Verificar com perfis distintos a visibilidade por Secretaria e as permissões para cadastrar, aprovar e abrir o processo.
- [ ] Após aprovação, criar o processo, conferir seus itens e abrir o DFD vinculado. Repetir a conversão e verificar que o processo é o mesmo.
- [ ] Registrar aceite e reconciliar o histórico antes de uma implantação controlada no SMS2. Consolidação entre Secretarias, classificação de catálogo e publicação externa pertencem a etapas posteriores.


## IA multiprovedor — implantação no SMS2 (23/11/2026)

A entrega disponibiliza cadastro de OpenAI, Google Gemini, Anthropic Claude, Azure OpenAI e APIs compatíveis com OpenAI; seleção de principal/alternativas; allow-list por Secretaria; failover; métricas de tokens e estimativa de custos.

- [x] Aplicar as migrations `20261123144614_platform_ai_multi_provider.sql` e `20261123144927_fix_ai_non_primary_provider_failure.sql` diretamente no SMS2.
- [x] Executar o teste pgTAP com 20 verificações de tabelas, RLS/FORCE RLS, privilégios, RPCs, endpoint e trigger de autorização.
- [x] Executar teste comportamental transacional: falha do único provedor secundário autorizado, promoção de fallback, desligamento quando todos os provedores falham; fixtures e segredos sintéticos revertidos por rollback.
- [x] Confirmar que nenhuma chave pode ser lida por `anon` ou `authenticated`, e que as três tabelas novas usam RLS e FORCE RLS.
- [x] Publicar `platform-ai-configuration` versão 18 e `primus-ai` versão 17, ambas com `verify_jwt=true`.
- [x] Confirmar configuração global desligada, zero provedores cadastrados e nenhuma Secretaria habilitada automaticamente.
- [ ] Cadastrar credenciais reais diretamente no Painel Master e testar individualmente os cinco adaptadores com modelos/deployments e endpoints autorizados.
- [ ] Validar consumo, tokens e custos com chamadas reais de cada provedor.
- [ ] Revisar contratos, retenção, privacidade e eventual transferência internacional de dados antes de liberar dados institucionais.
- [ ] Executar CI completo, teste de navegador e smoke test autenticado após o cadastro das credenciais.

**Estado:** banco e backend multiprovedor estão implantados no SMS2. O SMS2 não possuía configuração OpenAI nem credencial legada antes da implantação; o registro global inicial foi criado desligado. Nenhuma chave real foi fornecida ou armazenada e nenhum provedor está ativo. A IA global permanece desligada até que o Administrador Master cadastre e teste uma credencial e autorize expressamente os provedores/capacidades por Secretaria.
