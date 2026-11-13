# Checklist GO / NO-GO — Gestão de Fornecedores da Saúde

## Estado consolidado mais recente — 13/11/2026

**Decisão atual: NO-GO para produção e comercialização.** Os testes automatizados e o isolamento multitenant avançaram, mas ainda faltam comprovações externas e aceite visual/formal.

**Código e banco**
- Repositório oficial: `artemiosds/supabase-connected-app`, branch `main`; commit de código homologado nesta fotografia: `612a26a2592dd3d9e5cd671dbe922c86e8fab6f3`.
- SMS2: **88 migrations no repositório e 88 registradas no banco**, da `20261104131949` até `20261113145643`; nenhuma versão ausente ou extra.
- Schema `public`: 40 tabelas, 40/40 com RLS, 29 com FORCE RLS, nenhuma view pública e nenhuma tabela com SELECT concedido a `anon`.
- As 35 funções `SECURITY DEFINER` públicas executáveis por `authenticated` foram revisadas individualmente e protegidas por testes: 35/35 com `search_path=''`, 0 executáveis por `anon` e 0 com EXECUTE herdado de `PUBLIC`. O aviso do Advisor permanece porque são RPCs intencionais expostas a usuários autenticados; não revogar em massa.
- Advisor de saúde sem findings. O Advisor de performance mostra 81 índices sem uso observado (INFO); não removê-los sem carga real e benchmark.

**Evidências CI e E2E**
- Validação de aplicação, build, TypeScript, Deno, lint, migrations em banco descartável, pgTAP, restauração sintética e testes do transporte de e-mail: [run 43487193588](https://github.com/artemiosds/supabase-connected-app/actions/runs/43487193588). Resultado: **22 arquivos de testes SQL, 418 verificações pgTAP e 22 arquivos Vitest com 136 testes, PASS**.
- Formatação: [run 43487193600](https://github.com/artemiosds/supabase-connected-app/actions/runs/43487193600).
- E2E autenticado com duas Secretarias fictícias: [run 43487193705](https://github.com/artemiosds/supabase-connected-app/actions/runs/43487193705). Ambas as contas fizeram login HTTP 200, leram apenas os próprios dados, tiveram leituras/escritas cruzadas negadas e passaram pelo ciclo DOCX.
- O E2E verificou três versões DOCX imutáveis no Storage privado, download e igualdade SHA-256, bloqueio de acesso cruzado e limpeza de objeto órfão. Pela própria interface, restaurou a versão histórica 2 como versão 4 e comprovou o reanexo dos bytes originais.
- O dry-run da Edge Function processou 4 candidatos, com 0 enviados, 0 falhas e 0 incertos. Nenhum e-mail real foi enviado.
- O pgTAP adicional da outbox verifica unicidade, reivindicação atômica, retry até cinco tentativas, conclusão como enviado e bloqueio de reprocessamento de estado ambíguo.
- O transporte Resend foi isolado em função testável; cinco testes usam um provedor simulado para sucesso, HTTP 4xx, HTTP 5xx, resposta sem ID e erro de rede. O código mantém resultados ambíguos sem retry automático. A nova lógica foi validada em CI, mas **não foi implantada no SMS2** e nenhum envio real foi feito.

**Limites e decisões**
- O teste de criptografia/descriptografia restaura schema, dados, role e fixture DOCX sintéticos em PostgreSQL local descartável. **Ainda não é backup real do SMS2 nem restauração em outro projeto.**
- O bucket `gfs-private-documents` no SMS2 é privado, limite 20 MiB e MIME allowlist configurada. As tabelas de modelos/fontes/timbrado/documentos e o bucket estão sem registros/objetos reais; por isso, a fidelidade visual com modelos oficiais não foi homologada.
- A proteção contra senhas vazadas foi **dispensada por decisão do responsável**. Manter Supabase Free; não contratar Pro nem tentar contornar a limitação.
- O repositório GitHub é público. Artefatos de backup só podem ser publicados criptografados; a identidade privada age deve ficar offline, fora do GitHub.
- Nenhuma migration, fixture ou dado operacional foi gravado no SMS2 nesta rodada de homologação.

### Pendências que realmente bloqueiam o encerramento
1. Configurar os secrets do backup (`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, variável pública `AGE_RECIPIENT`) e guardar a identidade privada age fora do GitHub; executar backup real e restaurar em banco/projeto isolado.
2. Configurar SMTP/Resend e domínio de envio, validar SPF/DKIM/DMARC, Auth URLs e origens permitidas; executar um envio controlado para endereço de teste. Manter o agendamento automático desligado até essa aprovação.
3. Receber modelos DOCX oficiais anonimizados e brasões/timbrados autorizados para comparação visual de Word/PDF, paginação e recursos não suportados.
4. Obter aceite formal da Secretaria para os fluxos, documentos e operação antes de qualquer liberação comercial.

Google Drive OAuth e gateway/webhooks de pagamento continuam como integrações próprias; não são comprovados pelos testes atuais nem devem ser declarados concluídos por existirem telas/configurações.

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
