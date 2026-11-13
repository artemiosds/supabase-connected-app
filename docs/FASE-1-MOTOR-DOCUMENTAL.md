# Fase 1 — Motor documental

**Status em 12/11/2026: em homologação técnica; não liberar para produção ou venda.**

## Entregas implementadas no código

- Importação de DOCX com análise de placeholders, inclusive quando a expressão está dividida entre runs.
- Armazenamento imutável do DOCX original por versão do modelo em bucket privado; ao reabrir/editar ou restaurar uma versão, o sistema recupera a fonte original e a reanexa à nova versão quando aplicável.
- Geração Word a partir do original para preservar parágrafos, runs, estilos e tabelas; substituição de placeholders e expansão de linhas repetíveis.
- Geração PDF com cabeçalho/rodapé, paginação, margens, tamanho de página e brasão configuráveis por Secretaria.
- Configuração do timbrado por Secretaria: título, subtítulo, rodapé, brasão privado PNG/JPEG (até 300 KB), margens e paginação.
- Auditoria de mudanças do timbrado e RLS por Secretaria.
- Pré-análise de recursos DOCX não reproduzidos no PDF; exportação PDF bloqueada quando a perda de conteúdo ou paginação seria insegura.
- Prévia orientativa e lista de campos pendentes no rascunho; o botão de envio à aprovação é desabilitado no cliente e a RPC do banco também bloqueia placeholders vazios e não configurados.

## Limites conhecidos do PDF

O DOCX original continua sendo a referência de preservação. O PDF é produzido por um renderizador próprio e não é um conversor Microsoft Word/LibreOffice. Fontes/cores e estilos de tabela avançados podem ser simplificados e são sinalizados. Imagens, caixas de texto, objetos incorporados, revisões controladas, campos não resolvidos, seções múltiplas, listas numeradas e tabelas aninhadas bloqueiam a exportação PDF para evitar omissões. Nesses casos, deve-se usar o Word original ou ajustar o modelo.

Cabeçalhos/rodapés padrão em texto e a configuração de página são lidos do DOCX. Variantes de primeira página ou páginas pares bloqueiam PDF. A fidelidade visual de modelos reais ainda precisa de homologação com arquivos aprovados pela Secretaria. A tela de modelo é textual: se o usuário alterar o texto importado, o vínculo com o DOCX original é descartado; um editor visual rico que preserve a formatação durante alterações ainda é critério aberto.

## Migrações e produção

- `20261112124000_document_template_binary_source.sql`: vínculo do DOCX original à versão do modelo.
- `20261112124500_tenant_document_branding.sql`: configuração institucional por Secretaria, metadados do brasão, RLS, políticas de Storage e auditoria.
- `20261112125000_block_unconfigured_document_fields.sql`: bloqueio server-side de envio para aprovação quando permanecem campos pendentes ou não configurados.

Essas migrations são aditivas e passaram por aplicação/testes pgTAP em banco Supabase descartável na CI. Não devem ser aplicadas ao SMS2 de produção antes de backup e teste de restauração comprovados em ambiente separado. A ausência dessas tabelas em produção deve resultar em fallback seguro, sem quebrar a geração textual.

## Critérios ainda obrigatórios para encerrar a Fase 1

1. CI verde no commit final, incluindo unit tests, build, TypeScript, lint, formatação e testes SQL em banco descartável.
2. Aplicar as migrations em ambiente de homologação isolado e validar RLS/Storage com duas Secretarias e papéis diferentes.
3. Importar e exportar modelos DOCX representativos (texto, tabelas, placeholders divididos, linhas repetíveis, cabeçalho, rodapé, paisagem e brasão), comparar Word e PDF visualmente e registrar os recursos não suportados.
4. Validar os dados automáticos do processo/contrato por meio das funções autorizadas no servidor; nenhuma informação calculada deve ser confiada ao cliente.
5. Confirmar prévia orientativa, lista explícita de campos pendentes no rascunho e bloqueio de envio à aprovação quando houver `[PREENCHER: ...]`, `[CAMPO NÃO CONFIGURADO: ...]` ou placeholders `{{...}}`.
6. Validar armazenamento privado, troca/remoção do brasão, rollback em falha de upload e trilha de auditoria.
7. Obter aprovação formal da homologação antes de qualquer implantação em produção.

## Validação de código — commit `1e6207cec299912a8212595a0ffd57c5928f5dc7`

- CI completo aprovado: testes unitários, build de produção, TypeScript, verificação das Edge Functions, lint e formatação.
- O teste de segurança aplica as 79 migrations em Supabase descartável e executa as regressões pgTAP; resultado aprovado no run [43271911944](https://github.com/artemiosds/supabase-connected-app/actions/runs/43271911944).
- Foram adicionados testes para centralização do timbrado em páginas retrato/paisagem e rejeição de pacotes DOCX compactados com conteúdo interno acima dos limites antes da descompactação.
- A prévia Lovable informa o mesmo commit e estado `ready`; a conferência visual autenticada e com modelos reais ainda não foi concluída.
- O SMS2 continua com 74 migrations até `20261112123300`; `document_template_sources` e `tenant_document_branding` permanecem ausentes. Nenhuma migration foi aplicada à produção.

**A Fase 1 continua em homologação. CI verde não substitui testes visuais, autenticação, isolamento entre Secretarias e aceite formal.**


## Atualização de validação — 12/11/2026, commit `49dd493e6be34b8e143831b46c17861045474d76`

- [x] Corrigida a expressão regular da política de limpeza de DOCX órfão em Storage; a alteração final reduziu o escape duplicado que fazia a migration falhar.
- [x] CI do commit passou integralmente: validação de aplicação e segurança do banco. O job de banco iniciou Supabase local, aplicou as migrations e executou as regressões pgTAP com sucesso ([run 43280660261](https://github.com/artemiosds/supabase-connected-app/actions/runs/43280660261)). A formatação também passou ([run 43280660696](https://github.com/artemiosds/supabase-connected-app/actions/runs/43280660696)).
- [x] Revisados os fluxos de reabertura, restauração e salvamento do DOCX em `src/routes/_authenticated/documentos.tsx`.
- [ ] Ainda é necessária homologação E2E das falhas parciais: texto salvo com upload DOCX falho, metadata recusada, falha de limpeza do objeto órfão, download original indisponível e restauração com reanexo.
- [ ] A interface deve ser testada para confirmar que a mensagem parcial é clara e que o usuário consegue retomar a operação sem confundir versão textual com versão que preserva o Word.

O fluxo atual salva a versão textual e depois envia o DOCX original. Se o upload ou o vínculo dos metadados falhar, o sistema informa explicitamente que o texto foi salvo, mas o original não foi anexado. Na restauração, a nova versão textual também é registrada antes do reenvio do original, e falhas são informadas. Esse desenho evita declarar sucesso completo indevidamente, mas não torna a operação entre banco e Storage uma transação única; por isso, falhas parciais e limpeza de órfãos precisam de homologação específica.

**O resultado verde da CI valida o código e as migrations em banco descartável. Não comprova isolamento visual/autenticado entre Secretarias, fidelidade de modelos reais, recuperação de backup ou aceite formal. Fase 1 permanece em homologação e NO-GO para produção/venda.**


## Atualização de validação — 12/11/2026, commit `4e79bf6accf1f5b50b4c648233bfcfdb4e84d108`

- [x] Ampliado o teste pgTAP de aprovação documental de 4 para 13 verificações.
- [x] Cobertura estrutural de RLS/FORCE RLS, policies de leitura autenticada, vínculo composto documento/Secretaria, bloqueio de acesso sem identidade ou sem acesso à Secretaria, bloqueio de concorrência por `FOR UPDATE`, módulo habilitado, aprovação por pessoa diferente, justificativa mínima para devolução e trilha de eventos/auditoria.
- [x] CI integral do commit aprovado: validação da aplicação e segurança do banco descartável, incluindo aplicação de migrations e regressões pgTAP ([run 43284764341](https://github.com/artemiosds/supabase-connected-app/actions/runs/43284764341)); formatação aprovada ([run 43284764170](https://github.com/artemiosds/supabase-connected-app/actions/runs/43284764170)).
- [ ] Ainda falta teste comportamental completo com fixtures de duas Secretarias e usuários com papéis reais de envio/aprovação, incluindo placeholder pendente, envio válido, aprovação pelo segundo usuário e tentativa de acesso cruzado.
- [ ] E2E autenticado de upload/restauração DOCX, retry, limpeza de órfãos e homologação visual continuam pendentes.

A cobertura nova reforça regressões automatizadas, mas parte das verificações ainda é estrutural e os dois testes comportamentais atuais validam apenas o fechamento seguro para sessão ausente e usuário sem acesso à Secretaria. Não equivale a homologar o fluxo completo com duas Secretarias.

**Fase 1 permanece em homologação e NO-GO para produção/venda. SMS2 não foi alterado.**


## Atualização de validação — 12/11/2026, commit `a7bcd6073e7d960b99e54e1f694eccf9c0bae741`

- [x] CI completo aprovado no run [43288209117](https://github.com/artemiosds/supabase-connected-app/actions/runs/43288209117): job `validate` e job `database-security` concluídos com sucesso.
- [x] O job de segurança iniciou Supabase local, aplicou todas as migrations do repositório em banco descartável e executou a regressão pgTAP.
- [x] Corrigida a contagem do teste `contract_arp_item_balances.test.sql`: 28 assertions executadas e plano ajustado para 28.
- [x] Teste `procurement_process_workflow.test.sql` cobre 22 verificações estruturais da proteção de transições de etapa e checklist.
- [x] A migration `20261112125500_guard_procurement_process_stage_transitions.sql` adiciona validações no banco para impedir pulo de etapas, avanço sem checklist concluído, conclusão fora da etapa final e alterações de identidade/tenant.
- [x] Proteções contra respostas assíncronas antigas após troca de Secretaria foram adicionadas às telas de processos e fornecedores.
- [ ] A cobertura de workflow de processos ainda precisa de fixtures comportamentais completas, com papéis autenticados e tentativas válidas/inválidas; o teste estrutural não substitui essa homologação.
- [ ] A tela de documentos ainda precisa de revisão específica para corrida de carregamento ao trocar de Secretaria.
- [ ] Permanecem pendentes E2E de falhas parciais DOCX, retry, restauração/reanexo, limpeza de órfãos e homologação visual com modelos reais anonimizados.
- [ ] Permanecem pendentes isolamento autenticado com duas Secretarias e backup/restauração em projeto separado.

**Resultado:** CI técnico aprovado no commit indicado. SMS2 não recebeu migrations nesta etapa. A Fase 1 continua em homologação e permanece **NO-GO para produção/venda**.


## Atualização de validação — 12/11/2026, commit `7a4fdaedfd61c0df305236332921ae844bb9aff6`

- [x] CI completo aprovado no run [43290173715](https://github.com/artemiosds/supabase-connected-app/actions/runs/43290173715): validação da aplicação e segurança do banco concluídas com sucesso.
- [x] A migration `20261112132000_harden_procurement_process_stage_guard.sql` foi aplicada em Supabase local descartável junto com as demais migrations.
- [x] Teste de workflow de contratação ampliado de 24 para 33 assertions: 9 novas verificações comportamentais exercitam bloqueios e transições válidas com fixtures sintéticas revertidas.
- [x] Tela de documentos agora invalida requisições antigas, limpa os dados da Secretaria anterior durante a troca de contexto e só exibe a lista quando a consulta corresponde ao tenant selecionado.
- [x] O erro de carregamento passou a ser apresentado separadamente do estado de falta de permissão.
- [x] Há testes comportamentais com fixtures sintéticas para avanço, salto, checklist retroativo, imutabilidade de identidade e conclusão/reabertura do processo.
- [ ] Ainda falta E2E autenticado com dois tenants, papéis distintos e tentativas de acesso cruzado; a fixture SQL usa contexto de banco privilegiado e não simula sessões reais de usuários.
- [ ] E2E autenticado de salvamento/restauração DOCX, falha parcial, retry, limpeza de órfãos e download continua pendente.
- [ ] Homologação visual com modelos DOCX oficiais anonimizados e timbrados reais continua pendente.
- [ ] Isolamento visual e de Storage entre duas Secretarias e backup/restauração em projeto separado continuam pendentes.

**Resultado:** aplicação, formatação, migrations e regressões pgTAP aprovadas em ambiente descartável. SMS2 permanece sem alteração. Fase 1 continua em homologação e NO-GO para produção/venda.


## Atualização de validação — 12/11/2026, commit `cc4441c720c2cd73dd958d97d62717c19e899022`

- [x] CI completo aprovado no run [43292377124](https://github.com/artemiosds/supabase-connected-app/actions/runs/43292377124), com validação da aplicação, testes unitários, build, tipos, lint, migrations e pgTAP.
- [x] Formatação aprovada no run [43292377134](https://github.com/artemiosds/supabase-connected-app/actions/runs/43292377134).
- [x] Migration `20261112133000_force_document_template_source_rls.sql` aplicada em banco descartável; tabela de DOCX originais agora força RLS.
- [x] Teste `document_template_sources_security.test.sql` ampliado para 8 assertions, incluindo FORCE RLS e política de leitura por tenant.
- [x] Troca de Secretaria fecha diálogos de edição/histórico/geração, limpa arquivos selecionados e invalida resultados antigos.
- [x] Salvamento de modelos DOCX captura o tenant de origem, conclui o vínculo binário no tenant correto e impede respostas atrasadas de alterar o formulário de outra Secretaria.
- [x] Falha ao limpar arquivo órfão após falha de metadata agora é explicitamente reportada.
- [x] Análise DOCX assíncrona descarta resultados caso o usuário tenha mudado de Secretaria durante o processamento.
- [ ] Ainda faltam E2E autenticados de upload/download Storage, falha parcial, retry e restauração/reanexo em navegador.
- [ ] Homologação visual com modelos oficiais DOCX anonimizados e timbrados reais continua pendente.
- [ ] Isolamento E2E de duas Secretarias e backup/restauração em projeto separado continuam pendentes.

**Resultado:** CI automatizado completo verde. O teste automatizado não substitui homologação visual/autenticada e recuperação real de backup. SMS2 não recebeu migrations. Fase 1 continua em homologação e permanece **NO-GO para produção/venda**.


## Atualização de segurança e CI — 12/11/2026, commit `2a3570daef8d931f6bcf2a9e5c4e7ab033c9d51b`

- [x] Importação DOCX reforçada com CRC-32 do XML principal e validação de consistência entre diretório central e cabeçalho local ZIP (nome, flags, método e tamanhos).
- [x] Testes unitários específicos rejeitam XML principal corrompido e cabeçalho local divergente.
- [x] Ações assíncronas da tela Documentos protegidas contra troca de Secretaria durante seleção/importação, criação de URL temporária, cadastro/upload e arquivamento.
- [x] Upload de arquivo de fornecedor sem vínculo é removido se a Secretaria mudar antes de registrar seus metadados.
- [x] CI integral aprovado no run [43302243085](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243085): testes unitários, build, TypeScript, Deno, lint, aplicação de 82 migrations em banco descartável e pgTAP.
- [x] Formatação aprovada no run [43302243137](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243137).
- [ ] Testes E2E autenticados de upload/download Storage, falha parcial, retry, restauração/reanexo e limpeza de órfãos.
- [ ] Homologação visual com modelos DOCX oficiais anonimizados e brasões/timbrados aprovados.
- [ ] Teste real de isolamento com duas Secretarias, usuários com papéis distintos e tentativas de acesso cruzado ao Storage.
- [ ] Backup e restauração em projeto Supabase separado, incluindo Auth, Storage, RLS, funções e downloads.
- [ ] Aceite formal da Secretaria antes de qualquer implantação.

O CI comprova a suíte automatizada e as migrations em banco descartável; não comprova interação autenticada no navegador, fidelidade visual de DOCX reais nem recuperação de backup. As oito migrations posteriores a `20261112123300` continuam fora do SMS2. **A Fase 1 permanece em homologação e NO-GO para produção/venda.**


## Regressão comportamental do workflow — 12/11/2026, commit `44862e0749f52e70b7bf111b1dd611dc5593c094`

- [x] `procurement_process_workflow.test.sql` agora possui 33 assertions, incluindo 9 verificações comportamentais.
- [x] Fixture sintética cria usuário Auth, Secretaria, processo e item de checklist dentro de transação com ROLLBACK.
- [x] Verifica checklist pendente, avanço válido, salto de etapas, inclusão retroativa, etapa imutável, ID imutável, conclusão na etapa final, bloqueio de reabertura e imutabilidade do checklist concluído.
- [x] CI completo aprovado no run [43304160591](https://github.com/artemiosds/supabase-connected-app/actions/runs/43304160591), incluindo migrations em banco descartável e pgTAP; formatação aprovada no run [43304160274](https://github.com/artemiosds/supabase-connected-app/actions/runs/43304160274).
- [ ] E2E autenticado entre duas Secretarias, com perfis e Storage, continua pendente.

O teste usa apenas dados sintéticos e faz ROLLBACK; não grava no SMS2. A Fase 1 continua em homologação e NO-GO para produção/venda.


## Atualização de correções assíncronas — 13/11/2026, commit `01d35ab49fe6750175b18ae2d5186c5fe2a460a6`

- [x] O salvamento de modelo interrompe o fluxo antes do upload se a Secretaria ativa mudou enquanto a consulta da origem binária estava em andamento.
- [x] A limpeza de upload temporário após troca de Secretaria e após falha no vínculo dos metadados permanece protegida e reporta falhas de limpeza.
- [x] CI integral aprovado no run [43306515714](https://github.com/artemiosds/supabase-connected-app/actions/runs/43306515714): `validate` e `database-security` concluídos com sucesso; migrations aplicadas em Supabase local descartável e regressões pgTAP aprovadas.
- [ ] O repositório ainda não possui configuração Playwright/Cypress nem suíte E2E de navegador. O ciclo DOCX e o isolamento com duas Secretarias ainda precisam de ambiente de homologação autenticado, usuários sintéticos e modelos DOCX anonimizados.
- [ ] Backup/restauração em projeto separado e aceite visual da Secretaria continuam pendentes.

**Estado:** CI integral verde no commit `01d35ab`. Não foi executada homologação autenticada de navegador e não houve alteração no SMS2. A Fase 1 permanece em homologação e NO-GO para produção/venda.
