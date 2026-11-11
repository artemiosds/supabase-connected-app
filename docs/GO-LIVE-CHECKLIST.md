# Checklist GO / NO-GO — Gestão de Fornecedores da Saúde

> **Estado verificado em 11/11/2026 — prevalece sobre as fotografias anteriores neste documento.** Consulta somente leitura ao Supabase SMS2 e CI do commit `49ec420f4d202dc040ae893b606e50b7f5050e06`:
> - O schema `public` tem 35 tabelas e todas estão com RLS habilitada. Há 68 versões de migration registradas, até `20261111021946` (`link_generated_documents_to_contracts`). O repositório tem 69 arquivos SQL; `20261106194000` não tem versão correspondente no histórico remoto. Alguns arquivos foram registrados sob versões/timestamps diferentes; não executar `db push` ou reparo do histórico sem comparar cada migration.
> - Há 1 Secretaria e 1 vínculo municipal; 2 perfis; nenhum fornecedor, documento operacional, processo, contrato, aditivo ou documento gerado. Catálogo global contém 5 modelos. Outbox de notificações está vazia.
> - Cinco Edge Functions estão ativas: `invite-tenant-user` v15, `platform-billing-config` v13, `invite-platform-support-agent` v6, `invite-platform-staff` v4 e `send-expiry-notifications` v3. As quatro primeiras exigem JWT; a última usa `verify_jwt = false` e autenticação por segredo de servidor. Ativa não significa que e-mail real ou scheduler esteja homologado.
> - No commit acima passaram formatação, testes utilitários/unitários, build, TypeScript, Deno, lint, inicialização do Supabase local sem Mailpit, aplicação de migrations e testes pgTAP. Nenhum dado fictício foi escrito no SMS2 e nenhum e-mail real foi enviado.
> - Integrações/configurações ainda pendentes: SMTP e agendamento de alertas, Drive OAuth, gateway/webhooks de pagamento, restore de backup em projeto separado e homologação autenticada com duas Secretarias. O estado permanece **NO-GO para venda/liberação comercial**.


**Verificação:** 10/11/2026  
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
- [ ] Homologar importação TXT/MD/DOCX; DOCX importa texto e tabelas simples, não o layout original.
- [ ] Testar versionamento, snapshots, campos obrigatórios, geração, impressão e auditoria.
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
