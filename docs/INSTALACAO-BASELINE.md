# Baseline de processos e contratos — instalações novas

## Por que existe este arquivo

O Supabase SMS2 contém as tabelas `procurement_processes`, `process_items`, `contracts` e `contract_amendments`, com RLS/FORCE RLS e políticas comerciais. Entretanto, o DDL que as criou não aparece no histórico de migrations registrado no projeto.

A baseline `supabase/operations/baseline_phase3_process_contracts.sql` recompõe a estrutura inicial para instalações novas. Ela fica em `operations`, fora de `migrations`, porque precisa ser aplicada entre as migrations da Fase 2 e as migrations comerciais da Fase 3.

## Ordem de instalação limpa

1. Criar o projeto Supabase e aplicar as migrations de Fundação (Fase 1) e Fornecedores/Documentos (Fase 2), incluindo helpers de autorização, auditoria e índices compostos de fornecedores.
2. Executar uma vez a baseline `supabase/operations/baseline_phase3_process_contracts.sql` no SQL Editor, após confirmar as pré-condições no cabeçalho do arquivo.
3. Continuar com as migrations comerciais da Fase 3, depois Fase 4 e GED (Fase 5.1).
4. Conferir RLS e FORCE RLS nas quatro tabelas, políticas base e comerciais, chaves compostas e gatilhos.

## SMS2 atual

**Não executar a baseline no SMS2 atual.** As quatro tabelas já existem e foram inspecionadas. A baseline não precisa ser aplicada novamente nem registrada retroativamente; o SMS2 deve permanecer com o histórico já aplicado. O arquivo antigo `pending_phase3_contracts_and_processes.sql` foi substituído por um aviso de obsolescência.

## Limites

- A baseline cria a estrutura inicial e as políticas permissivas de papel. As migrations comerciais da Fase 3 devem ser aplicadas depois para acrescentar políticas RESTRICTIVE, suporte de leitura Master e bloqueios comerciais por módulo.
- Antes de utilizar uma instalação nova em produção, executar o roteiro de homologação com duas Secretarias e papéis distintos.
