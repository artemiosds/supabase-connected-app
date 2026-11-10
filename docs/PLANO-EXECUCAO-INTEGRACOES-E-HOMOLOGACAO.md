# Plano de conclusão — Gestão de Fornecedores da Saúde

**Atualizado:** 10/11/2026  
**Código:** `artemiosds/supabase-connected-app` / `main`  
**Banco:** Supabase SMS2, `rwbbznqtocunzrpcvjvk`.

## Objetivo
Deixar o código e a estrutura prontos para homologação posterior, sem cadastrar pessoas/dados fictícios no SMS2, enviar convites reais ou alterar migrations remotas durante o ciclo de preparação. O diagnóstico completo está em [docs/DIAGNOSTICO-FASES-2026-11-10.md](DIAGNOSTICO-FASES-2026-11-10.md).

## Sequência técnica
1. PR #8 (importação DOCX) e PR #9 (alertas visuais de contratos/documentos) já estão integrados ao `main` e passaram CI completo. Homologar a conversão DOCX com modelos de teste; não preserva layout/figuras do Word. O sino não envia e-mail ou WhatsApp.
2. PR #10 está no `main`: migration adicional para as cinco tabelas da Equipe Interna e índices de FKs de suporte. Ainda não aplicada ao SMS2. O PR #12 reforça as políticas como `AS RESTRICTIVE` e acrescenta 55 assertions pgTAP; aguardar CI e revisão antes de qualquer implantação.
3. Completar cancelamento/revogação e reenvio de convites internos e de suporte. Não apagar automaticamente Auth users quando ocorrer falha.
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

## Preparação de código — continuação em 10/11/2026

O escopo atual é concluir código e estrutura, com homologação real posterior.
Nenhuma alteração desta etapa deve aplicar migrations, publicar funções ou enviar e-mails.

### Entrega preparada: alertas
- Chamadas sem `dry_run: false` são simulações: calculam contadores sem gravar outbox nem chamar o provedor. O endpoint mantém autenticação por segredo e exige configuração do servidor.
- O scheduler informa explicitamente `dry_run: false` somente no fluxo de envio já condicionado à ativação/confirmação.
- Falhas e resultados incertos tornam o workflow malsucedido; não são apresentados como envio concluído.
- Chamadas ao provedor têm timeout de 15 segundos; resultado ambíguo permanece para reconciliação manual, preservando prevenção de duplicidade.
- Assuntos preservam letras e removem quebras de linha reais.
- Deploy de Edge Functions agora é exclusivamente manual, com `confirm_deploy`, para separar commits de código da implantação.

### Pendências de implementação ainda abertas
1. Reenvio seguro de convites internos/suporte para identidades Auth existentes.
2. Google Drive OAuth por Secretaria, armazenamento protegido dos tokens, refresh e revogação.
3. Adaptador de cobrança e webhooks conforme gateway escolhido; o painel de configuração não equivale a processamento de pagamentos.
4. PDF server-side, caso exigido, e definição do nível de assinatura.
5. Homologação de restauração, e-mails, isolamento e experiência mobile/tablet/desktop somente na etapa posterior.

O histórico de migrations permanece com a correspondência documentada no roadmap; nenhuma reconciliação foi executada nesta preparação. Não tratar os itens acima como concluídos apenas por haver telas ou configuração.
