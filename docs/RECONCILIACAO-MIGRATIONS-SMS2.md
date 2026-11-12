# Reconciliação do histórico de migrations do SMS2

Auditoria somente de leitura em **12/11/2026**. Fonte do código: `main` em
`6ee4e2935a84ae0c04cbe901e223af2ece563c38`. Nenhuma alteração foi feita
no banco de produção. Não executar `db push` enquanto os dois históricos divergem.

## Estado comprovado

- `supabase_migrations.schema_migrations` contém **68** versões; o repositório
  contém **75** arquivos SQL. Não inferir aplicação por nome ou por presença de
  uma tabela apenas.
- Sete arquivos locais foram registrados no SMS2 com outro timestamp. Em seis,
  `statements[1]` coincide **exatamente** com o arquivo correspondente; no
  sétimo, o SQL coincide após remover comentários e espaços, mas os textos
  brutos diferem. Nenhum dos sete deve ser executado novamente sem reconciliação.

| Arquivo no repositório | Versão registrada no SMS2 | Comparação |
| --- | --- | --- |
| `20261110143000_platform_internal_staff_default_deny_and_support_fk_indexes.sql` | `20261110180336` | Idêntico |
| `20261110144000_revoke_pending_internal_invitations.sql` | `20261110180349` | Idêntico |
| `20261110150000_platform_staff_remaining_fk_indexes.sql` | `20261110180400` | Idêntico |
| `20261110151000_expiry_notification_outbox.sql` | `20261110180414` | Idêntico |
| `20261110210500_remove_duplicate_contract_index_and_index_workflow_actor_fks.sql` | `20261110234352` | Idêntico |
| `20261110230000_fix_duplicate_contract_amendment_execution.sql` | `20261111021638` | Idêntico |
| `20261110230500_link_generated_documents_to_contracts.sql` | `20261111021946` | Mesma lógica SQL; o arquivo local contém cinco linhas adicionais de comentário |

- `20261106194000_restore_operational_process_and_contract_tables.sql` não tem
  versão correspondente no histórico. Suas quatro tabelas, 14 índices e 12
  políticas nomeadas existem hoje. As quatro tabelas têm RLS habilitada e
  `FORCE ROW LEVEL SECURITY`. **Presença não comprova equivalência** das
  colunas, constraints, permissões, definições das políticas ou origem histórica.
- Seis migrations posteriores à última versão registrada permanecem apenas
  no código, nesta ordem:

| Versão | Mudança preparada | Indício de ausência no SMS2 |
| --- | --- | --- |
| `20261111043000` | Validação de URL de documento externo | Não presumir aplicação pela ausência de coluna; revisar constraint/função |
| `20261111110000` | Contexto contratual na geração de documentos | Revisar definição atual da RPC antes de publicar |
| `20261111143000` | Dez etapas com responsável e prazo | `process_items.responsible_name` e `due_date` ausentes |
| `20261111160000` | Histórico de sanções | `supplier_sanctions` ausente |
| `20261111200821` | Itens e saldo de contrato/ARP | `contract_items` e `contract_item_movements` ausentes |
| `20261112114000` | DOCX original privado por versão | `document_template_sources` ausente |

As seis migrations foram analisadas estaticamente: nenhuma contém `UPDATE`,
`DELETE`, `TRUNCATE` ou `DROP TABLE` em SQL de topo. Há DDL que pode trocar
constraints, políticas, funções e triggers. Isso exige revisão de locks,
dependências e comportamento antes da implantação; a contagem de linhas para
atualização/exclusão em massa é **zero**, pois nenhuma foi planejada.

## Gate para uma implantação segura

1. Congelar novas mudanças de schema durante a janela. Obter backup do banco e
   Storage; restaurar uma cópia isolada e provar que ela abre. Registrar plano
   de retorno e responsáveis. O backup/restauração ainda não foi homologado.
2. Na cópia, comparar a migration `20261106194000` contra o catálogo completo:
   colunas, defaults, constraints, FKs, índices, políticas e grants. Resolver
   diferenças por nova migration forward-only; não reaplicar políticas antigas
   sobre o SMS2.
3. Registrar o mapeamento de sete aliases com hashes/conteúdo e versões. Preparar
   a correção do histórico com ferramenta oficial e revisão humana, sem editar
   `supabase_migrations.schema_migrations` manualmente. Simular antes na cópia;
   preservar evidência dos registros originais e um plano de reversão.
4. Recomparar as seis migrations pendentes com o catálogo da cópia. Aplicar em
   ordem, uma por vez, sob controle de timeout/locks, verificar RLS, grants,
   funções e dados após cada etapa. O CI em banco descartável já passou, mas
   não representa os dados e permissões reais do SMS2.
5. Só após a reconciliação comprovada, repetir o rollout autorizado no SMS2.
   Testar os fluxos autenticados com perfis reais e duas Secretarias, sem
   persistir fixtures reais. Registrar versões, logs, resultados e retorno.

Este documento **não autoriza** alterar histórico, schema ou dados em produção.
O usuário pediu confirmação antes dessas mudanças; preparar e conferir todo o
plano primeiro. Lovable permanece somente para preview.
