# Roadmap — Gestão de Fornecedores da Saúde

Atualizado em **08/11/2026**, com conferência direta do repositório GitHub main, do Supabase SMS2 e das execuções de validação.

## Estado real verificado

- **Repositório oficial:** artemiosds/supabase-connected-app, branch main.
- **Banco gerenciado:** Supabase SMS2, projeto rwbbznqtocunzrpcvjvk, região São Paulo.
- **Pré-visualização:** Lovable conectado ao GitHub. O preview pronto e um build verde não substituem homologação autenticada no navegador.
- **Migrations:** 46 aplicadas no Supabase e 46 arquivos SQL correspondentes em supabase/migrations. Não há migration aplicada ausente no repositório nem arquivo SQL versionado pendente. As duas últimas são 20261108200651_create_procurement_process_with_atomic_checklist e 20261108210335_select_procurement_quote_including_delivery_cost.
- **Banco operacional:** 24 tabelas no schema público; 24/24 com RLS habilitado e 13/24 com FORCE ROW LEVEL SECURITY. Existem 18 permissões cadastradas.
- **Identidades:** 2 usuários Auth, dos quais 1 é Administrador Master ativo. Há 0 Secretarias, 0 vínculos municipais e 0 convites.
- **Dados operacionais:** 0 fornecedores, 0 documentos de fornecedor, 0 modelos instalados por Secretaria, 0 processos, 0 itens de processo/checklist, 0 itens de contratação, 0 cotações, 0 dotações, 0 contratos, 0 aditivos e 0 documentos gerados. O catálogo global tem 5 modelos-base.
- **GED:** bucket gfs-private-documents existe, é privado e tem limite de 20 MiB; 0 objetos armazenados.
- **Cobrança:** 0 contas de gateway cadastradas; payments_enabled=false. Não existe cobrança real ativa.
- **Testes reversíveis:** a criação atômica de processo foi testada numa Secretaria temporária dentro de transação com ROLLBACK: 11 itens padrão foram criados; um título inválido foi rejeitado sem deixar processo parcial. A consulta posterior confirmou zero Secretarias e processos persistidos.

## FASE 1 — Fundação multitenant e segurança

**Estrutura implementada. Homologação operacional com clientes de teste ainda pendente.**

Inclui perfis vinculados ao Supabase Auth; Secretarias e estados operacionais/comerciais; administração global separada; membros, papéis, permissões e vínculos compostos; provisionamento; controle de módulos, plano, mensalidade, trial e limites; RLS, FORCE RLS e auditoria; dados institucionais e validação de CNPJ numérico/alfanumérico.

### Evidências e limites da Fase 1
- 24/24 tabelas públicas estão com RLS; 13 usam FORCE RLS.
- As restrições institucionais de validação estão formalmente validadas; não há CHECK constraints pendentes de validação no schema público.
- Os privilégios internos de autorização são separados; ainda é necessário confirmar no Dashboard que app_auth não aparece em Project Settings → API → Exposed schemas.
- O Administrador Master já existe e está confirmado. **Não executar novamente o bootstrap inicial** em SMS2.
- Testes transacionais anteriores validaram provisionamento, regras de papéis e algumas barreiras de isolamento. O cenário completo com dois usuários municipais distintos e duas Secretarias continua pendente de homologação autenticada ponta a ponta.
- O SMS2 permanece no Free. O Security Advisor aponta auth_leaked_password_protection; a proteção contra senhas vazadas requer plano Pro ou superior. Nenhum upgrade pago foi feito.

## FASE 2 — Fornecedores, documentos e operação

**Estrutura principal implementada. Homologação funcional e operacional com usuários municipais ainda pendente.**

### Fase 2.1 — Fornecedores
Cadastro com CNPJ, razão social, nome fantasia, categoria, contatos e endereço; validação de CNPJ e unicidade por Secretaria; pesquisa, filtros, edição, inativação e reativação; permissões por papel, auditoria e isolamento por tenant.

### Fase 2.2 — Documentos e gestão
Documentos de fornecedor, datas de validade, links/arquivos e arquivamento; indicadores de vencidos e prazos; catálogo global de modelos, instalação por Secretaria, versionamento, snapshots e geração; assinatura eletrônica simples; usuários municipais, convites, papéis, suspensão e reativação; painel, configurações e histórico.

### Limites conhecidos
- **Google Drive:** links são reconhecidos, mas OAuth e sincronização de pastas do Drive não estão configurados. O GED desta versão usa o bucket privado Supabase Storage.
- **GED:** bucket privado, políticas e validação de formato/tamanho estão preparados; upload/download real, URLs temporárias e isolamento entre duas Secretarias ainda precisam ser homologados com usuários municipais.
- **PDF:** a via atual é feita pela impressão do navegador. Não há geração PDF server-side nem arquivo final assinado persistido como artefato imutável.
- **Assinatura:** eletrônica simples; não é assinatura qualificada ICP-Brasil nem integração com provedor.
- **Alertas:** vencimentos aparecem na interface; envio agendado por e-mail/WhatsApp ainda depende de SMTP/provedor e agendador.
- **Importação:** não há importador Word DOC/DOCX nativo.

## FASE 3 — Processos, compras e contratos

**Módulos estruturados implementados. Homologação de regras, integrações e escala ainda pendente.**

Inclui esteira de processos e checklist; itens, quantidades e preços estimados; cotações e seleção de referência; dotações; contratos e aditivos; integração com snapshots e documentos gerados.

### Correção de consistência aplicada
A criação do processo e seus 11 itens de checklist agora ocorre numa única RPC transacional, com validação de permissão, situação comercial e módulo contratado. A tela usa o cliente Supabase tipado; o alias genérico dbFase3 foi removido. As consultas operacionais usam paginação estável e as cotações são buscadas apenas para os itens do processo aberto, em blocos de até 100 IDs. A criação atômica do processo foi testada e título inválido não gera processo incompleto.

A seleção da cotação de referência agora incorpora frete proporcionalmente: total da cotação (produto + frete) dividido pela quantidade cotada, com arredondamento de quatro casas para o valor unitário. O item estimado reflete o custo integral. A RPC trava o item durante a seleção e o índice único parcial mantém uma única cotação de referência por item.

### Homologação pendente
- Testar itens, três ou mais cotações, escolha de referência, cálculo, dotação e contrato com dados controlados.
- Conferir modalidades, etapas, consistência dos aditivos, imutabilidade de dados críticos e trilha de auditoria com gestor municipal.
- Executar duas Secretarias de homologação e comprovar isolamento em processos, cotações, orçamento, contratos, aditivos e GED.
- Verificar paginação e desempenho com dados volumosos; não há carga real no banco para medir escala.

## FASE 4 — Convites, identidade e e-mail

A tabela de convites, RPCs de criação/aceite/revogação, reserva de vagas e Edge Function de envio estão implementadas. Falta configurar e testar o serviço de e-mail real: SMTP de domínio verificado, SPF/DKIM/DMARC, Supabase Auth Site URL/Redirect URLs, APP_URL e INVITE_ALLOWED_ORIGINS na Edge Function, e o fluxo completo de cadastro, confirmação, recuperação, convite, definição de senha, aceite, revogação e expiração.

## FASE 5 — Backup e continuidade

O workflow Encrypted SMS2 backup exporta schema/dados/roles da aplicação, baixa objetos do GED e criptografa o pacote com age antes do upload como artefato GitHub Actions. O pacote não inclui Auth identities/passwords, configuração do projeto, Storage metadata, SMTP nem secrets de Edge Functions.

Antes de confiar no backup, é necessário criar e guardar a identidade privada age offline; configurar AGE_RECIPIENT, SUPABASE_DB_URL e SUPABASE_SERVICE_ROLE_KEY como secrets/variables do GitHub; executar manualmente, validar hash e descriptografar; restaurar em projeto separado e homologar login/vínculos/GED; e só então habilitar SUPABASE_BACKUP_ENABLED=true para a agenda semanal. Não há evidência de backup manual e restauração concluídos em ambiente separado.

## FASE 6 — Cobrança, LGPD e operação comercial

Cadastro seguro de conta de gateway e guarda de credenciais no Vault estão implementados. Ainda não existe adaptador de Mercado Pago/Stripe, OAuth de gateway, criação de clientes/assinaturas/cobranças, webhook assinado, idempotência, conciliação ou automação de inadimplência. payments_enabled permanece forçado como falso; a tabela de integração está vazia. Preços, tributos, cancelamento, estorno, contrato comercial, termos, privacidade, retenção, suporte, SLA e plano de incidentes precisam ser definidos e revisados. Domínio oficial, TLS, allowlists e ambiente de produção também não foram concluídos.

## Qualidade e liberação

- O workflow de formatação/validação executou os testes do aplicativo, build, TypeScript e lint com sucesso antes do commit automático de formatação, inclusive nos ajustes do parser monetário e seleção de cotação. A execução aprovada mais recente é GitHub Actions #42523480227; o commit final de formatação é 68aac20746e6061851892c4a8a85a0452ed44877.
- O cliente genérico dbFase3 foi removido; Processos, Contratos, Fornecedores e Documentos usam o cliente Supabase tipado. O parser monetário comum aceita formatos brasileiros e internacionais e é usado nos formulários de compras, contratos e aditivos; a suíte possui 14 testes para as regras de contratação e conversão.
- A paginação compartilhada foi aplicada às listas de fornecedores, documentos, processos, modelos, contratos, itens, cotações e dotações; cotações no detalhe de processo são carregadas apenas para os itens selecionados, em blocos de até 100 IDs.
- Um smoke test transacional validou fornecedor, processo, checklist de 11 etapas, item, cotação selecionada, dotação, contrato, aditivo, documento de fornecedor, modelo, documento gerado, assinatura simples e convite. A cotação total foi R$ 40,00, o item estimado R$ 30,00, o aditivo atualizou o término do contrato e o segundo convite foi bloqueado no limite. Tudo terminou em ROLLBACK e a consulta posterior confirmou o banco sem dados fictícios.
- O workflow Encrypted SMS2 backup ainda não possui execuções registradas; não há evidência de artefato criptografado ou restauração testada.
- O roteiro GO/NO-GO está em docs/GO-LIVE-CHECKLIST.md; backup em docs/ROTINA-DE-BACKUP.md.
- Performance Advisor registra 63 índices INFO não utilizados, esperado com tabelas sem carga operacional. Não remover índices sem medição com dados reais.

## Decisão de liberação

**NO-GO para produção comercial neste momento.** A estrutura do banco, módulos centrais e CI estão avançados, mas faltam homologação autenticada de duas Secretarias, upload/download real do GED, SMTP, backup restaurável, domínio, cobrança efetiva, revisão jurídica/LGPD e plano de operação. O próximo passo técnico é uma homologação controlada e documentada; não reconstruir a fundação.
