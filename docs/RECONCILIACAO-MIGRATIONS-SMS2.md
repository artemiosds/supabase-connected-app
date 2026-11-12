# Reconciliação de migrations — SMS2

**Auditoria de leitura somente em 12/11/2026.** Projeto Supabase SMS2: `rwbbznqtocunzrpcvjvk`. A fonte de código é `artemiosds/supabase-connected-app`, branch `main` (mais a branch de alinhamento referida abaixo).

## Estado remoto confirmado

- `supabase_migrations.schema_migrations`: **74 versões**.
- Repositório antes do alinhamento: **75 arquivos SQL**.
- Duas migrations locais não têm versão correspondente no SMS2: `document_template_binary_source` e `complete_foreign_key_index_coverage`. A primeira cria `public.document_template_sources`, confirmada ausente; a segunda adiciona seis índices de FK e foi integrada ao `main` pelo PR #18, ainda não aplicada ao banco.
- A baseline `20261106194000_restore_operational_process_and_contract_tables` existe no histórico remoto com `statement_count=0`. As estruturas operacionais estão presentes; esse registro vazio é marcador de histórico. Não reexecutar o arquivo de baseline no SMS2.
- As três versões `20261110120237`, `20261110120321` e `20261110121323` de `enforce_support_identity_separation` estão registradas, uma para cada execução idempotente. Os três arquivos locais devem permanecer preservados.
- A migration de fonte DOCX não está aplicada.

## Cinco migrations aplicadas com timestamp remoto diferente

| Prefixo antigo local | Versão registrada no SMS2 | Nome |
| --- | --- | --- |
| `20261111043000` | `20261112122904` | `validate_supplier_document_external_urls` |
| `20261111110000` | `20261112122950` | `expand_contract_context_in_document_generation` |
| `20261111143000` | `20261112123048` | `expand_ten_stage_procurement_workflow` |
| `20261111160000` | `20261112123128` | `supplier_sanction_history` |
| `20261111200821` | `20261112123300` | `contract_arp_item_balances` |

A branch `chore/align-applied-supabase-migration-versions` renomeia esses cinco arquivos para os timestamps efetivamente registrados no SMS2. O SQL não é alterado.

## Migration nova, ainda pendente

A migration local `20261112114000_document_template_binary_source.sql` foi movida, sem alteração do SQL, para `20261112124000_document_template_binary_source.sql`. O PR #18 adicionou `20261112150000_complete_foreign_key_index_coverage.sql`, após a última versão remota `20261112123300`. As duas migrations permanecem pendentes.

Ela cria a fonte binária privada por versão de modelo Word. A tabela `document_template_sources` foi consultada e está ausente no SMS2. A migration é futura; não foi aplicada nesta preparação.

## Scripts históricos de reparo

Os arquivos `docs/REPARO-HISTORICO-SMS2.sql` e `docs/REPARO-HISTORICO-SMS2-REVERSAO.sql` documentaram uma operação anterior de correção de metadata. A leitura atual do histórico mostra que as sete versões mapeadas e a entrada-marker da baseline já estão registradas nos prefixos esperados. **Não executar novamente nenhum dos dois scripts.** A reversão também não deve ser usada depois que migrations posteriores foram aplicadas.

## Não executar

- Não executar `supabase db push` indiscriminadamente.
- Não reaplicar migrations que já aparecem no histórico remoto.
- Não executar a baseline `20261106194000` no SMS2.
- Não aplicar `20261112124000_document_template_binary_source.sql` até revisão/CI e uma janela de implantação futura.
- Não alterar manualmente `supabase_migrations.schema_migrations` sem novo diff de catálogo, backup e plano documentado.

A homologação de restore continua pendente; a reconciliação do histórico não equivale a backup. O código foi alinhado para futuras ferramentas CLI, mas nenhum rollout de `document_template_sources` foi feito nesta etapa.


## PR #18 — cobertura restante de índices FK

O PR #18 foi integrado ao `main` após CI integral verde, incluindo aplicação das migrations em Supabase descartável e pgTAP. Ele adiciona seis índices:

- `contract_item_movements.created_by`
- `contract_items.created_by`
- `contract_items.updated_by`
- `generated_documents(template_id, tenant_id)`
- `supplier_sanctions.created_by`
- `supplier_sanctions.updated_by`

A migration é `20261112150000_complete_foreign_key_index_coverage.sql`. Nenhum desses índices foi aplicado ao SMS2. A consulta de catálogo confirma que ainda não existem como índices locais correspondentes, e o Advisor continua registrando seis FKs sem cobertura. Aplicar somente em uma janela futura, depois de revisão/backup conforme o plano de implantação.

