# Roadmap — Gestão de Fornecedores da Saúde

Atualizado em **10/11/2026** após integração da importação DOCX e dos alertas visuais. A análise detalhada está em [docs/DIAGNOSTICO-FASES-2026-11-10.md](docs/DIAGNOSTICO-FASES-2026-11-10.md).

## Fotografia atual
- SMS2 tem **59 migrations aplicadas** até `20261110121336`.
- Repositório `main` tem a migration adicional `20261110143000` para explicitar negação RLS e indexar FKs de suporte; já está no código, mas ainda não foi aplicada ao SMS2. O PR #12 prepara a política restritiva e amplia testes; aguarda CI.
- 32 tabelas públicas, todas com RLS; 21 com FORCE RLS; 114 políticas.
- 1 Secretaria, 1 vínculo municipal, 1 Master, 2 contas Auth.
- Equipe Interna: cinco perfis e sete permissões; zero funcionários.
- Suporte técnico: zero técnicos, atribuições e sessões.
- Quatro Edge Functions ativas: convites municipais v12, configuração de cobrança v10, convite suporte v3, convite equipe interna v1.
- Nenhum dado operacional (fornecedores/documentos/processos/contratos); cinco modelos-base globais e GED privado sem objetos.
- O sino visual já reúne vencimentos de contratos e documentos de fornecedores; ainda sem scheduler/e-mail/WhatsApp. Google Drive OAuth, gateway ativo e backup restaurado continuam pendentes.

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
**NO-GO para produção comercial.** Não reconstruir Fases 1 e 2. DOCX já importa parágrafos e tabelas simples como texto editável; alertas visuais cobrem contratos e documentos. Priorizar fluxo de convites, provar isolamento com duas Secretarias, testar GED e recuperar backup antes de inserir dados reais.

## Atualização de implantação — 10/11/2026, conferência direta

Esta atualização prevalece sobre os retratos anteriores deste documento.

- As quatro migrations pendentes foram aplicadas ao SMS2: políticas restritivas internas, revogação de convites, sete índices de FKs e outbox de alertas.
- SMS2 agora registra 63 migrations. A outbox existe, força RLS e não permite leitura nem claim pelo papel authenticated; service_role pode executar claim.
- Cinco políticas restritivas internas, sete índices e ambas as RPCs de revogação foram confirmados por consulta ao catálogo.
- O Supabase atribuiu versões de execução diferentes das versões dos arquivos. A reconciliação do histórico foi bloqueada pela revisão automática e NÃO foi executada. Não executar db push indiscriminadamente.

| Versão do arquivo | Versão registrada no SMS2 |
| --- | --- |
| 20261110143000 | 20261110180336 |
| 20261110144000 | 20261110180349 |
| 20261110150000 | 20261110180400 |
| 20261110151000 | 20261110180414 |

A baseline 20261106194000 também continua sem versão correspondente no histórico remoto; avaliar equivalência antes de qualquer reparo.

Cinco Edge Functions estavam ativas na auditoria, incluindo send-expiry-notifications. Sua dependência de banco foi implantada nesta etapa; envio efetivo, secrets e scheduler ainda não foram homologados. O CI do commit 9dbf29f passou build, testes, tipos, lint e regressões de banco local. A verificação desta implantação foi de catálogo/permissões; não substitui E2E autenticado.

Continuam pendentes: reconciliação do histórico, configuração e entrega de e-mail, homologação com duas Secretarias, GED no navegador, backup/restauração em ambiente separado, domínio/publicação e requisitos comerciais. Nenhum e-mail foi enviado nem dado operacional de teste persistido nesta etapa. NO-GO comercial permanece.
