# Checklist GO / NO-GO — Gestão de Fornecedores da Saúde

**Verificação:** 10/11/2026  
**Supabase:** SMS2, projeto `rwbbznqtocunzrpcvjvk`.

## Estado técnico verificado
- 59 migrations aplicadas no SMS2. O `main` contém uma migration futura adicional `20261110143000`, ainda não aplicada.
- 32 tabelas públicas; RLS em 32; FORCE RLS em 21; 114 políticas.
- 1 Secretaria e 1 vínculo municipal ativo; 1 Master; 2 contas Auth.
- Equipe Interna: 5 perfis padrão, 7 permissões, 0 contas.
- Equipe de Suporte: 0 técnicos, 0 atribuições, 0 sessões.
- Edge Functions ativas com JWT: `invite-tenant-user` v12, `platform-billing-config` v10, `invite-platform-support-agent` v3, `invite-platform-staff` v1.
- 5 modelos globais; 0 modelos instalados na Secretaria.
- 0 fornecedores/documentos/processos/itens/cotações/dotações/contratos/aditivos/documentos gerados.
- Bucket GED `gfs-private-documents` privado, 20 MiB, PDF/DOC/DOCX/XLS/XLSX/JPG/PNG; sem objetos.
- `pg_cron`/`pg_net` não instalados. Não há envio agendado de vencimentos.
- Cobrança desabilitada; nenhum gateway operacional.
- Google Drive OAuth não implementado.
- PR #8 DOCX foi integrado e passou CI completo, incluindo migration reset e pgTAP em banco local descartável.
- PR #9 alertas visuais está em validação; PR #10 RLS explícito/índices está no main, ainda não aplicado ao SMS2.
- Não há backup com restore comprovado; domínio/publicação final ainda não confirmados.

## Gate 1 — Auth, equipe e e-mail
- [ ] SMTP transacional configurado com domínio próprio verificado.
- [ ] SPF/DKIM/DMARC publicados e verificados.
- [ ] Supabase Auth Site URL e Redirect URLs configurados.
- [ ] `APP_URL` e `INVITE_ALLOWED_ORIGINS` configuradas com origens HTTPS exatas.
- [ ] Homologar cadastro, confirmação, login, recuperação e convite municipal.
- [ ] Homologar convite/aceite/senha/suspensão/reativação da Equipe Interna e Suporte.
- [ ] Completar cancelamento/revogação e reenvio de convites pendentes/expirados.
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
- [ ] Integrar PR #9 após CI verde.
- [ ] Definir regras, antecedência, destinatários, frequência, fuso e idempotência.
- [ ] Implementar envio no servidor e scheduler protegido.
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
