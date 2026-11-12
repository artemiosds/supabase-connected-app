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

## Validação de código — commit 6f3835e

- Testes unitários, build, TypeScript, lint, formatação e verificação das Edge Functions passaram.
- Migrations foram aplicadas em Supabase descartável e os testes de segurança/pgTAP passaram.
- Teste automatizado gera PDF com brasão PNG e valida o arquivo resultante.
- O SMS2 continua com 74 migrations; `document_template_sources` e `tenant_document_branding` permanecem ausentes. Nenhuma migration foi aplicada à produção.

**Não há autorização técnica para marcar esta fase como concluída apenas porque o CI passou.**
