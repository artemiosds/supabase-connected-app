# Plano de conclusão — Gestão de Fornecedores da Saúde

**Atualizado:** 10/11/2026  
**Código:** `artemiosds/supabase-connected-app` / `main`  
**Banco:** Supabase SMS2, `rwbbznqtocunzrpcvjvk`.

## Objetivo
Deixar o código e a estrutura prontos para homologação posterior, sem cadastrar pessoas/dados fictícios no SMS2, enviar convites reais ou alterar migrations remotas durante o ciclo de preparação. O diagnóstico completo está em [docs/DIAGNOSTICO-FASES-2026-11-10.md](DIAGNOSTICO-FASES-2026-11-10.md).

## Sequência técnica
1. Fechar PR #9 (alertas de vencimento) com unit tests, build, TypeScript, lint, formato e db reset/pgTAP.
2. Manter PR #10 já integrado no main: migration adicional de deny-all explícito para as cinco tabelas da Equipe Interna e índices de FKs de suporte. A migration ainda não está aplicada no SMS2; aplicar apenas em janela futura depois de backup e aprovação de implantação.
3. Completar cancelamento/revogação/reenvio de convites internos e de suporte. Não apagar automaticamente Auth users quando ocorrer falha.
4. Homologar GED, modelos, geração, processos, itens, cotações, orçamento, contratos e aditivos com duas Secretarias em ambiente descartável.
5. Escolher provedor de e-mail e scheduler; implementar alerta recorrente com idempotência, retentativas, auditoria e isolamento por tenant.
6. Implementar Google Drive OAuth por Secretaria, com state/PKCE, escopos mínimos, tokens guardados apenas no backend/cofre, refresh e revogação.
7. Executar backup criptografado e restore em projeto separado; não restaurar no SMS2 em uso.
8. Escolher gateway, implementar adaptador/webhooks em Sandbox, definir planos/preço/tributos/cancelamento.
9. Fechar LGPD/contratos, domínio/TLS, ambientes, monitoramento, SLA, suporte, proteção de branch e piloto.

## Dependências do proprietário
- Domínio oficial e DNS.
- Provedor SMTP e verificação SPF/DKIM/DMARC.
- Contas Google Cloud/OAuth e Drive de homologação.
- Gateway e credenciais Sandbox/produção.
- E-mails controlados para homologação.
- Decisão de plano Supabase e aprovação de custos/upgrade.
- Aprovação jurídica de termos, privacidade, retenção e contrato.

Credenciais devem ser inseridas diretamente nos painéis/cofres, nunca pelo chat, navegador ou arquivos versionados.

## Critério de encerramento
O código estará pronto para homologação quando os PRs e migrations futuras passarem nas suítes locais, as funções tiverem controles server-side e o runbook refletir o estado real. A liberação comercial só acontece após SMTP, duas Secretarias isoladas, GED autenticado, restore comprovado, E2E no navegador, domínio, cobrança e jurídico concluídos.

**Status atual: NO-GO para produção comercial.**
