# Reconciliação de migrations — SMS2

**Auditoria de leitura somente em 12/11/2026.** Projeto Supabase SMS2: `rwbbznqtocunzrpcvjvk`. A fonte de código é `artemiosds/supabase-connected-app`, branch `main` (mais a branch de alinhamento referida abaixo).

## Estado remoto confirmado

- `supabase_migrations.schema_migrations`: **74 versões**.
- Repositório antes do alinhamento: **75 arquivos SQL**.
- A única migration local sem versão correspondente no SMS2 é `document_template_binary_source`; ela cria a tabela `public.document_template_sources`, que foi confirmada ausente no banco.
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

A migration local `20261112114000_document_template_binary_source.sql` foi movida, sem alteração do SQL, para `20261112124000_document_template_binary_source.sql`. O novo prefixo fica depois da última versão remota `20261112123300`, evitando que uma migration pendente tenha timestamp anterior ao histórico aplicado.

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
