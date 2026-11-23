# Renovação contratual inteligente

## Escopo

A Central de Renovações organiza a instrução de prorrogações e não realiza renovação automática. O fluxo atual de minuta atende exclusivamente a contratos de serviços ou fornecimentos contínuos regidos pela Lei nº 14.133/2021, quando a classificação e os requisitos do caso concreto permitirem.

Contratos por escopo (art. 111), atas de registro de preços e instrumentos submetidos a regimes especiais não devem ser encaminhados automaticamente ao modelo do art. 107. Eles permanecem identificados na tela e precisam de fluxo jurídico próprio.

## Etapas do profissional

1. Classificar o regime jurídico e a natureza do objeto.
2. Confirmar a previsão de prorrogação no edital e no contrato.
3. Registrar a justificativa da continuidade, o interesse público e o relatório de execução/fiscalização.
4. Elaborar o comparativo econômico com valores em uma mesma base, fonte, data, metodologia e análise qualitativa.
5. Registrar a manifestação da contratada, a manutenção da habilitação, a disponibilidade orçamentária e a autorização prévia.
6. Registrar o parecer jurídico ou a justificativa de uso de parecer referencial/não exigência individualizada conforme a regulamentação aplicável.
7. Atribuir cada providência documental a um membro ativo da Secretaria e definir prazo.
8. Solicitar ao servidor a validação do conjunto. Somente se o servidor confirmar todos os requisitos, o modelo poderá ser gerado como rascunho.

## Controles no servidor

- As tabelas de análise e checklist têm RLS e FORCE RLS.
- Usuários autenticados têm leitura sob política de tenant; as gravações ocorrem por RPCs que conferem usuário, permissão, situação da Secretaria, módulo contratado e vínculo do responsável ao tenant.
- A RPC `validate_contract_renewal_addendum` é a fonte autoritativa dos bloqueios.
- Um trigger em `generated_documents` chama a validação novamente antes de inserir ou trocar o tipo de documento para `term_addendum_renewal`. Uma chamada direta à API não contorna a trava.
- A geração não altera a vigência, não registra aditivo, não assina e não publica o instrumento.
- O limite de dez anos é verificado tanto pelos meses informados quanto pela data de início original do contrato.
- A minuta só pode ser gerada enquanto o contrato estiver vigente e antes do último dia da vigência cadastrada.

## Comparativo econômico

A variação exibida é:

`((valor contratado - valor de referência) / valor de referência) × 100`

Valor positivo indica que o preço contratado está acima da referência; valor negativo indica que está abaixo. O cálculo é informativo e não substitui o ateste motivado de vantajosidade. A análise deve considerar também qualidade, desempenho, custos de transição e custos de uma nova contratação, além das condições específicas do objeto.

## Checklist inicial

- Classificação jurídica e regime aplicável.
- Previsão no edital.
- Previsão no contrato.
- Justificativa da natureza contínua.
- Relatório de execução e fiscalização.
- Comparativo e ateste de vantajosidade.
- Anuência expressa da contratada.
- Habilitação e regularidade atualizadas.
- Créditos e disponibilidade orçamentária.
- Autorização prévia da autoridade competente.
- Parecer jurídico ou fundamento de aplicação de parecer referencial/não exigência individualizada.

Uma providência obrigatória só pode ser concluída com referência da evidência. A etapa jurídica pode ser marcada como não aplicável somente quando a análise registrar a justificativa correspondente.

## Base de referência

- Lei nº 14.133/2021, especialmente arts. 105, 106, 107 e 111.
- Modelos e Lista de Verificação de Aditivos da Advocacia-Geral da União (AGU). São referências federais e devem ser adaptadas à regulamentação do ente.
- Manual Operacional de Gestão e Fiscalização Contratual do Ministério da Gestão e da Inovação em Serviços Públicos (MGI), versão 1.0, junho de 2025. Sua orientação é referência operacional federal, não substitui norma local nem análise do caso concreto.

## Implantação

A migration `20261119160000_contract_renewal_assessment_workflow.sql` deve ser aplicada depois das migrations anteriores já versionadas na branch `main`. A publicação do frontend sem a migration deixa a análise estruturada indisponível; o acompanhamento básico de renovações permanece separado.
