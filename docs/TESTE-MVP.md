# Roteiro de validação do MVP

Este roteiro é para testar o sistema com contas e registros de teste reais, sem compartilhar credenciais.

## 1. Preparar os usuários

O SMS2 já possui um administrador global ativo e confirmado. **Não execute novamente** `supabase/operations/bootstrap_first_platform_admin.sql`; esse script é reservado a uma instalação nova, sem administrador global.

1. Acesse `/cadastro` em uma janela anônima e crie uma segunda conta com um e-mail que você controla.
2. Confirme o e-mail pelo link recebido.
3. Volte à conta de administrador global e abra **Organizações**.
4. Crie uma Secretaria de teste e escolha a segunda conta como administrador municipal.
5. Entre com a conta municipal. A conta global é administrativa da plataforma e não recebe acesso operacional automático à Secretaria.

## 2. Validar fornecedores

1. Cadastre um fornecedor com CNPJ numérico válido.
2. Cadastre outro fornecedor com um CNPJ alfanumérico válido quando tiver um número oficial disponível.
3. Teste pesquisa por razão social, nome fantasia e CNPJ.
4. Teste filtros de categoria e situação.
5. Edite um registro e inative/reative outro.
6. Confirme que a tela não oferece exclusão física.

## 3. Validar documentos e vencimentos

1. Registre um documento de fornecedor com data de emissão, vencimento e link externo.
2. Confira os estados vencido, vence em até 30 dias e em dia.
3. Cadastre um modelo usando campos como `{{fornecedor}}`, `{{cnpj}}`, `{{secretaria}}`, `{{municipio}}` e `{{data}}`.
4. Gere um documento, revise o texto final, imprima ou salve como PDF pelo navegador.
5. Registre a assinatura eletrônica simples com uma conta autenticada e verifique a imutabilidade do conteúdo assinado.

## 4. Validar GED privado de documentos

1. Ative os módulos Fornecedores e Documentos na Secretaria de teste e atribua as permissões de consulta/criação documental.
2. Cadastre um fornecedor e registre um documento anexando um PDF menor que 20 MB.
3. Abra o arquivo pela ação de download; a aplicação deve usar URL assinada temporária, não URL pública.
4. Repita com DOC/DOCX, XLS/XLSX, JPG e PNG. Tente anexar arquivo acima de 20 MB, executável renomeado e conteúdo incompatível com a extensão; a interface deve recusar.
5. Acesse o fornecedor com conta de outra Secretaria e confirme que o arquivo não fica visível nem acessível.
6. Arquive o documento e confirme que um novo link assinado não pode ser gerado. O objeto permanece preservado no Storage para retenção/histórico.
7. Tente editar o registro para substituir o arquivo; o sistema deve exigir novo documento, preservando o original.
8. Teste um documento externo e um link do Drive para confirmar que a compatibilidade anterior foi preservada.
## 5. Validar modelos e geração por processo

1. Ative os módulos Processos, Documentos e Modelos na Secretaria de teste.
2. Com o perfil que possui gestão de modelos, abra a Biblioteca-base e instale DFD, ETP, Mapa de Análise de Riscos, Matriz Contratual de Alocação de Riscos e TR.
3. Edite uma cópia instalada, informe um resumo da alteração e salve. Confira que a versão aumenta e que a anterior aparece no Histórico, sem possibilidade de edição.
4. Cadastre um processo de teste com número, objeto, justificativa, unidade requisitante e responsável.
5. Gere DFD, ETP, Mapa de Análise de Riscos e TR a partir do processo. Preencha os campos obrigatórios e confirme que o rascunho registra o processo e o conteúdo original.
6. Tente gerar deixando um campo obrigatório vazio; a operação deve ser bloqueada também pelo banco.
7. Com uma segunda Secretaria, confirme que não é possível instalar/consultar modelos privados da primeira nem vincular documentos a processos de outro tenant.
8. Imprima/salve o documento como PDF pelo navegador e confirme que a assinatura disponível é simples, não ICP-Brasil.

**Atenção:** a Matriz Contratual de Alocação de Riscos é separada do Mapa de Análise de Riscos e só deve ser utilizada após avaliação do cabimento e da necessidade no caso concreto.

## 6. Validar compras estruturadas e orçamento

1. Crie um processo de teste e inclua itens com descrição, unidade de fornecimento, quantidade e especificação.
2. Cadastre pelo menos três cotações para um item, com fornecedor, preço unitário, frete e fonte de referência.
3. Escolha uma cotação como referência; confirme que a seleção é atômica e que apenas uma cotação fica marcada como escolhida por item.
4. Confira o cálculo dos valores e o contexto utilizado na geração do DFD/ETP/TR.
5. Cadastre uma dotação por exercício, unidade orçamentária, programa/ação, natureza da despesa, fonte e valor alocado.
6. Teste atualização e arquivamento da cotação e da dotação; confira o histórico e o isolamento por Secretaria.

## 7. Validar convites por e-mail

Antes do teste, configure SMTP próprio no Supabase e inclua o domínio de homologação em **Authentication → URL Configuration**. Consulte `docs/CONFIGURAR-CONVITES-E-MAIL.md`.

1. Com um administrador municipal, convide um endereço de e-mail novo e selecione o papel Operador.
2. Confirme a entrega da mensagem, abra o link, confirme o endereço e defina uma senha.
3. Entre com a conta convidada e confira que o vínculo foi criado somente na Secretaria que enviou o convite e com o papel selecionado.
4. Tente aceitar o mesmo convite novamente; não deve criar vínculo duplicado.
5. Convide um endereço já cadastrado e confirmado; o sistema deve orientar usar **Vincular conta existente**.
6. Crie outro convite pendente e cancele-o antes do aceite. Abrir o link cancelado não deve conceder acesso.
7. Configure uma Secretaria de teste com limite reduzido. Com todas as vagas preenchidas por vínculos ativos, tente enviar outro convite; o sistema deve bloquear.
8. Preencha as vagas restantes com convites pendentes; um convite adicional deve ser bloqueado. Cancele ou deixe expirar um convite e confirme que a vaga volta a ficar disponível.
9. Confira que usuários ativos mais convites pendentes e não expirados não excedem o limite contratado.
10. Confira o comportamento quando uma conta já possui vínculo suspenso ou inativo; aceitar convite não deve reativar esse vínculo automaticamente.
11. Consulte a auditoria e confira criação, aceite, expiração ou cancelamento do convite sem expor token/link de acesso.

## 8. Validar usuários e permissões

1. Crie mais duas contas municipais em janelas anônimas e confirme seus e-mails.
2. Na Secretaria de teste, vincule uma delas como Operador e outra como Consulta.
3. Confirme que Operador pode consultar/cadastrar fornecedores, mas não editar nem inativar.
4. Confirme que Consulta só visualiza os módulos autorizados.
5. Como Administrador local, altere o papel de um membro e suspenda/reative um vínculo.
6. Verifique que o sistema impede suspender a própria conta e remover o último Administrador ativo.

## 9. Validar separação entre Secretarias

1. Crie uma segunda Secretaria de teste com outra conta municipal.
2. Cadastre fornecedores e documentos em ambas.
3. Entre em cada conta e confira que somente os registros da própria Secretaria aparecem.
4. Tente usar IDs de registros da outra Secretaria em operações diretas; o banco deve negar a leitura e a alteração.

## 10. Conferir painel, configurações e histórico

1. Confira os indicadores do painel com os registros de teste.
2. Atualize dados institucionais da Secretaria e verifique CNPJ, e-mail, telefone, endereço, município e UF.
3. Consulte o histórico e verifique os eventos de criação, edição, arquivamento, alteração de papel e assinatura.
4. Confirme que um usuário sem a permissão correspondente não consegue executar a operação, mesmo tentando chamar a API diretamente.

## Limites conhecidos desta versão

- Documentos de fornecedores podem usar arquivo privado no Supabase Storage ou link externo/Drive. OAuth e sincronização automática com o Drive ainda precisam ser configurados.
- A geração de PDF utiliza a função de impressão do navegador.
- A assinatura disponível é eletrônica simples, vinculada à conta autenticada; não é certificado ICP-Brasil nem assinatura qualificada.
- Alertas de vencimento são exibidos no painel e na listagem; envio automático de e-mail/WhatsApp ainda precisa de um provedor e configuração.
- A proteção de senhas vazadas do Supabase Auth deve ser ativada antes de produção.

Não use dados pessoais reais nos primeiros testes. Prefira fornecedores e documentos fictícios de homologação.


## 11. Validar contratos e aditivos

1. No processo com cotação e dotação cadastradas, registre um contrato com fornecedor, objeto, valor, vigência, gestor e fiscal.
2. Confira que o contrato fica ligado à mesma Secretaria, ao fornecedor e ao processo selecionado.
3. Registre um aditivo de prorrogação e confirme que a data final do contrato é atualizada e que o evento aparece na auditoria.
4. Teste aditivos de acréscimo e supressão, verificando sinal, valor acumulado e limites autorizados no fluxo.
5. Tente associar fornecedor, processo ou contrato de outra Secretaria; o banco deve negar.
6. Arquive ou encerre um contrato e confirme que o histórico e os aditivos permanecem disponíveis para consulta.

## 12. Validar integridade e paginação

1. Crie mais de 500 registros de teste em cada lista relevante, em uma base de homologação separada.
2. Confira que Fornecedores, Documentos, Processos, Modelos, Contratos, Itens, Cotações e Dotações carregam todas as páginas, sem repetir ou pular linhas.
3. Inclua registros com a mesma data/nome/ordem e valide que o identificador secundário mantém paginação estável.
4. Consulte um processo com muitos itens e cotações; confirme que a tela carrega cotações somente para seus itens e em blocos de IDs.
5. Faça testes de carga com rede lenta e computador de desempenho limitado; registre tempo de primeira exibição, tempo total e memória utilizada.
