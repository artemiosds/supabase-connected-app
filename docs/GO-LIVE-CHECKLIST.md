# Checklist de liberação do SaaS — Gestão de Fornecedores da Saúde

Este documento é o critério de **GO / NO-GO** antes de colocar a plataforma em uso real por Secretarias. Estrutura e CI verdes não substituem homologação operacional, revisão jurídica e configuração dos serviços externos.

## Situação técnica conferida em 08/11/2026

- Supabase SMS2: 41 migrations registradas; última `20261108154457_tenant_first_invitation_mutation_locking`.
- 23 tabelas públicas da aplicação com RLS; 12 tabelas operacionais multi-tenant com FORCE RLS.
- As quatro RPCs públicas de convite são `SECURITY INVOKER`; nenhuma delas aceita execução por `anon`.
- `anon` e `authenticated` não possuem privilégios de TRUNCATE, TRIGGER, REFERENCES ou MAINTAIN nas tabelas públicas.
- GED privado `gfs-private-documents`: bucket não público, 20 MiB, PDF/DOC/DOCX/XLS/XLSX/JPG/PNG.
- Catálogo global com cinco modelos-base documentais.
- CI principal aprovado com testes Python de backup, testes do app, build, TypeScript e lint.
- Banco permanece sem Secretarias, vínculos, fornecedores, convites, processos, cotações, contratos ou arquivos reais. Não há homologação ponta a ponta com usuários municipais.

## Bloqueadores antes de produção

### 1. Identidade, Auth e e-mail

- [ ] Escolher e configurar provedor SMTP com domínio verificado.
- [ ] Configurar SPF, DKIM e DMARC no domínio remetente.
- [ ] Configurar Supabase Auth Site URL e allowlist de URLs de redirecionamento.
- [ ] Configurar `APP_URL` e `INVITE_ALLOWED_ORIGINS` na Edge Function para o domínio real.
- [ ] Testar cadastro, confirmação, recuperação de senha, convite, definição de senha, aceite, revogação e expiração.
- [ ] Definir política de senha com comprimento mínimo de pelo menos 8 caracteres e requisitos adequados.
- [ ] Decidir se o projeto será mantido no Free ou migrado para Pro. A proteção contra senhas vazadas é recurso Pro ou superior.

### 2. Onboarding e isolamento municipal

- [ ] Criar uma Secretaria de homologação usando dados fictícios, mas sem inserir registros diretamente como se fossem reais.
- [ ] Confirmar um administrador municipal por e-mail.
- [ ] Habilitar os módulos e atribuir somente as permissões necessárias.
- [ ] Criar uma segunda Secretaria de teste, com usuários e papéis distintos.
- [ ] Confirmar isolamento por tenant em fornecedores, documentos, processos, itens, cotações, orçamento, contratos, GED e auditoria.
- [ ] Testar bloqueio por Secretaria suspensa, bloqueio comercial, módulo desabilitado e limite de usuários.
- [ ] Testar reservas de convites e operações simultâneas no limite do plano.

### 3. GED, compras e documentos

- [ ] Fazer upload e download de PDF e dos outros tipos permitidos com usuário municipal.
- [ ] Confirmar URLs assinadas temporárias, arquivo privado, bloqueio após arquivamento e isolamento entre duas Secretarias.
- [ ] Testar fornecedor, documento e vencimento.
- [ ] Cadastrar itens, pelo menos três cotações, selecionar uma referência, vincular dotação e conferir cálculos.
- [ ] Instalar e personalizar os modelos DFD, ETP, Mapa de Análise de Riscos, Matriz Contratual de Alocação de Riscos e TR.
- [ ] Conferir snapshots, versionamento, campos obrigatórios, impressão e auditoria.
- [ ] Decidir se PDF server-side e armazenamento das vias finais são obrigatórios para o contrato comercial.
- [ ] Decidir qual nível de assinatura é necessário. A assinatura atual é eletrônica simples e não ICP-Brasil.

### 4. Backup, segurança e continuidade

- [ ] Gerar uma identidade age e guardar a chave privada offline; cadastrar somente a chave pública em `AGE_RECIPIENT`.
- [ ] Cadastrar `SUPABASE_DB_URL` e `SUPABASE_SERVICE_ROLE_KEY` como GitHub Secrets.
- [ ] Executar manualmente **Encrypted SMS2 backup**, conferir artefato criptografado, hash e descriptografia.
- [ ] Somente após o teste, definir `SUPABASE_BACKUP_ENABLED=true` para habilitar o agendamento semanal.
- [ ] Testar um procedimento de recuperação em projeto separado antes de confiar no backup.
- [ ] Definir estratégia adicional para Auth, identidades, configurações do projeto, secrets, logs e recuperação integral. O dump lógico do CLI exclui schemas gerenciados Auth/Storage.
- [ ] Definir retenção, responsável, monitoração e periodicidade para os artefatos de backup.
- [ ] Avaliar o upgrade do Supabase para backup diário gerenciado e proteção contra senhas vazadas; nenhum upgrade foi feito neste projeto.

### 5. Cobrança, LGPD e operação

- [ ] Escolher o provedor de cobrança (por exemplo, Mercado Pago ou Stripe) e abrir a conta comercial.
- [ ] Definir planos, preços, trial, impostos, faturas, cancelamento, estorno, inadimplência e conciliação.
- [ ] Configurar chaves privadas, webhook assinado, idempotência, logs e reconciliação do provedor.
- [ ] Definir controlador e operador de dados, finalidades, bases legais, retenção, direitos dos titulares e processo de incidente.
- [ ] Revisar termos de uso, política de privacidade, contrato de tratamento de dados e cláusulas com cada município com assessoria jurídica.
- [ ] Definir suporte, SLA, canal de incidentes, monitoramento, RPO/RTO e plano de continuidade.

### 6. Infraestrutura e publicação

- [ ] Definir o domínio oficial e DNS.
- [ ] Configurar TLS, redirects Auth, CORS/origens e secrets de produção.
- [ ] Separar ambiente de homologação e produção.
- [ ] Definir política de atualização, janela de manutenção e rollback.
- [ ] Fazer validação visual autenticada no domínio real.
- [ ] Aprovar formalmente o GO para produção após concluir os testes.

## Critério de decisão

**NO-GO:** qualquer item obrigatório acima sem evidência de teste, especialmente SMTP, backup restaurável, isolamento entre duas Secretarias, cobrança, termos/contratos, domínio e validação autenticada.

**GO controlado:** só após os bloqueadores de segurança, backup, onboarding e conformidade serem resolvidos e uma Secretaria piloto aprovar a operação.

## Limites conhecidos do backup do plano Free

O workflow deste repositório faz backup lógico dos schemas da aplicação, dados e roles e baixa os arquivos do bucket GED. O Supabase CLI exclui os schemas gerenciados `auth` e `storage`; portanto, o pacote não contém senhas/identidades Auth, configurações completas do projeto, secrets de Edge Functions ou configuração SMTP. Não é um backup integral nem substitui os backups diários gerenciados de planos elegíveis.
