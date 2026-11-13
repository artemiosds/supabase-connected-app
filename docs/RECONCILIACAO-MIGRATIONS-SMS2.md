# Reconciliação de migrations — SMS2

**Auditoria de leitura somente em 12/11/2026.** Projeto Supabase SMS2: `rwbbznqtocunzrpcvjvk`. A fonte de código é `artemiosds/supabase-connected-app`, branch `main` (mais a branch de alinhamento referida abaixo).

## Estado remoto confirmado

- `supabase_migrations.schema_migrations`: **74 versões**.
- Repositório atual `main`: **82 arquivos SQL**.
- Oito migrations futuras não têm versão correspondente no SMS2: fonte DOCX privada, timbrado por Secretaria, bloqueio de campos não configurados, guardas do workflow de contratação, FORCE RLS da fonte DOCX, cobertura de índices FK e remoção de políticas SELECT redundantes. As tabelas `public.document_template_sources` e `public.tenant_document_branding` foram confirmadas ausentes; nenhuma das oito foi aplicada ao banco.
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

## Migrations futuras, ainda pendentes

Após a última versão remota `20261112123300`, o `main` contém oito migrations futuras, todas aplicadas e testadas apenas em banco Supabase descartável na CI:

- `20261112124000_document_template_binary_source.sql`: fonte DOCX privada por versão de modelo.
- `20261112124500_tenant_document_branding.sql`: timbrado por Secretaria, brasão privado, RLS e auditoria.
- `20261112125000_block_unconfigured_document_fields.sql`: bloqueia envio documental quando restam campos pendentes.
- `20261112125500_guard_procurement_process_stage_transitions.sql`: bloqueia saltos de etapa, avanço com checklist pendente e conclusão indevida.
- `20261112132000_harden_procurement_process_stage_guard.sql`: endurece a imutabilidade do processo e das etapas do checklist.
- `20261112133000_force_document_template_source_rls.sql`: força RLS na tabela dos DOCX originais.
- `20261112150000_complete_foreign_key_index_coverage.sql`: seis índices de FK.
- `20261112162000_remove_redundant_master_select_policies.sql`: remove sete políticas SELECT redundantes.

As tabelas `document_template_sources` e `tenant_document_branding` foram consultadas e estão ausentes no SMS2. Nenhuma dessas migrations foi aplicada em produção.

## Scripts históricos de reparo

Os arquivos `docs/REPARO-HISTORICO-SMS2.sql` e `docs/REPARO-HISTORICO-SMS2-REVERSAO.sql` documentaram uma operação anterior de correção de metadata. A leitura atual do histórico mostra que as sete versões mapeadas e a entrada-marker da baseline já estão registradas nos prefixos esperados. **Não executar novamente nenhum dos dois scripts.** A reversão também não deve ser usada depois que migrations posteriores foram aplicadas.

## Não executar

- Não executar `supabase db push` indiscriminadamente.
- Não reaplicar migrations que já aparecem no histórico remoto.
- Não executar a baseline `20261106194000` no SMS2.
- Não aplicar nenhuma das cinco migrations futuras até revisão/CI, backup com restauração comprovada em projeto isolado e janela de implantação futura.
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



## Atualização de contagem — 12/11/2026

O repositório passou a conter 82 arquivos SQL. O SMS2 permanece em 74 versões até `20261112123300`; portanto, há oito migrations futuras não aplicadas, listadas acima. Todas as 82 migrations foram aplicadas em banco Supabase local descartável no CI do commit `2a3570daef8d931f6bcf2a9e5c4e7ab033c9d51b` ([run 43302243085](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243085)). Isso não autoriza aplicação no SMS2: backup/restore isolado e janela de implantação permanecem gates obrigatórios.


## Advisor remoto SMS2 — leitura somente em 13/11/2026

A consulta dos Advisors confirmou: health sem findings; 36 avisos de `SECURITY DEFINER` executáveis por `authenticated` (revisão individual obrigatória, sem revogação em massa); proteção de senha vazada desabilitada; seis FKs sem índice de cobertura; sete conjuntos de políticas SELECT permissivas redundantes; 72 índices sem uso observado. As migrations `20261112150000` e `20261112162000` já preparam os seis índices e a remoção das sete políticas redundantes, mas permanecem não aplicadas no SMS2. Não remover índices automaticamente em ambiente com baixo histórico de uso. Nenhuma configuração, migration ou dado remoto foi alterado nesta consulta.
