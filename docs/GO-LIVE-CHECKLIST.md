# Checklist GO / NO-GO — Gestão de Fornecedores da Saúde

> **Estado verificado em 12/11/2026 — prevalece sobre as fotografias históricas abaixo.** Consulta somente leitura ao Supabase SMS2 e CI do commit `1e6207cec299912a8212595a0ffd57c5928f5dc7`:
> - O schema `public` tem 38 tabelas, todas com RLS habilitada; 27 também usam FORCE RLS e existem 133 políticas. O histórico remoto registra 74 migrations até `20261112123300`. O repositório `main` tem 79 arquivos SQL e cinco migrations futuras não aplicadas: fonte DOCX, timbrado por Secretaria, bloqueio de campos pendentes, cobertura de índices FK e remoção de políticas SELECT redundantes.
> - Há 1 Secretaria, 1 vínculo municipal, 2 perfis e 2 identidades Auth; não há fornecedores, documentos operacionais, processos ou contratos. O catálogo global contém 5 modelos.
> - Cinco Edge Functions estão ativas: `invite-tenant-user` v15, `platform-billing-config` v13, `invite-platform-support-agent` v6, `invite-platform-staff` v4 e `send-expiry-notifications` v3. Ativa não significa que e-mail real ou scheduler esteja homologado.
> - CI completo do commit `1e6207c` passou testes unitários, build, TypeScript, Deno, lint, formatação, aplicação das 79 migrations em Supabase descartável e regressões pgTAP ([run 43271911944](https://github.com/artemiosds/supabase-connected-app/actions/runs/43271911944)).
> - O motor documental inclui DOCX original por versão, exportação Word, PDF por renderizador próprio, timbrado por Secretaria, bloqueio de campos pendentes e proteção contra DOCX ZIP excessivamente grande. O editor visual rico, E2E autenticado e homologação visual de modelos reais ainda não foram concluídos. Nenhum dado fictício foi escrito no SMS2 nem e-mail real enviado.
> - SMS2 continua sem `document_template_sources` e `tenant_document_branding`; nenhuma das cinco migrations futuras foi aplicada. Integrações/configurações ainda pendentes: SMTP e agendamento de alertas, Drive OAuth, gateway/webhooks de pagamento, restore de backup em projeto separado e homologação autenticada com duas Secretarias. O estado permanece **NO-GO para venda/liberação comercial**.

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
