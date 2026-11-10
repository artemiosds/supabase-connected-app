# Roadmap — Gestão de Fornecedores da Saúde

Atualizado em **10/11/2026**. A análise detalhada está em [docs/DIAGNOSTICO-FASES-2026-11-10.md](docs/DIAGNOSTICO-FASES-2026-11-10.md).

## Fotografia atual
- SMS2 tem **59 migrations aplicadas** até `20261110121336`.
- Repositório `main` tem uma migration adicional `20261110143000` para explicitar negação RLS e indexar FKs de suporte; já está no código, mas ainda não foi aplicada ao banco.
- 32 tabelas públicas, todas com RLS; 21 com FORCE RLS; 114 políticas.
- 1 Secretaria, 1 vínculo municipal, 1 Master, 2 contas Auth.
- Equipe Interna: cinco perfis e sete permissões; zero funcionários.
- Suporte técnico: zero técnicos, atribuições e sessões.
- Quatro Edge Functions ativas: convites municipais v12, configuração de cobrança v10, convite suporte v3, convite equipe interna v1.
- Nenhum dado operacional (fornecedores/documentos/processos/contratos); cinco modelos-base globais e GED privado sem objetos.
- Sem scheduler de alertas, Google Drive OAuth, gateway ativo ou backup restaurado.

## Resumo por fase

| Fase | Situação | Próximo marco |
| --- | --- | --- |
| 0 — Base técnica | Estrutura pronta | Proteção de branch e publicação final |
| 1 — Multitenant/RLS | Estrutura implantada | E2E com duas Secretarias |
| 2 — Fornecedores/GED/Documentos | Módulos implementados | GED real, Drive, PDF e assinatura definidos |
| 3 — Compras/Contratos | Núcleo implementado | Homologação completa no navegador |
| 4 — Usuários/Equipe/Suporte | Estrutura implantada | SMTP e ciclo completo de convites |
| 5 — Alertas/Integrações | Parcial | Alertas agendados, OAuth Drive, gateway |
| 6 — Backup/Continuidade | Código preparado | Backup e restore comprovados |
| 7 — Comercial/Produção | Não concluída | Cobrança, jurídico, domínio, SLA e piloto |

## Decisão
**NO-GO para produção comercial.** Não reconstruir Fases 1 e 2. Priorizar concluir fluxos parciais, provar isolamento com duas Secretarias, testar GED e recuperar backup antes de inserir dados reais.
