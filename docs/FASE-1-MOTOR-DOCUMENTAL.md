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
