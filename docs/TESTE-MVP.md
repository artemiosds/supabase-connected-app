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

## 4. Validar modelos e geração por processo

1. Ative os módulos Processos, Documentos e Modelos na Secretaria de teste.
2. Com o perfil que possui gestão de modelos, abra a Biblioteca-base e instale DFD, ETP, Mapa de Análise de Riscos, Matriz Contratual de Alocação de Riscos e TR.
3. Edite uma cópia instalada, informe um resumo da alteração e salve. Confira que a versão aumenta e que a anterior aparece no Histórico, sem possibilidade de edição.
4. Cadastre um processo de teste com número, objeto, justificativa, unidade requisitante e responsável.
5. Gere DFD, ETP, Mapa de Análise de Riscos e TR a partir do processo. Preencha os campos obrigatórios e confirme que o rascunho registra o processo e o conteúdo original.
6. Tente gerar deixando um campo obrigatório vazio; a operação deve ser bloqueada também pelo banco.
7. Com uma segunda Secretaria, confirme que não é possível instalar/consultar modelos privados da primeira nem vincular documentos a processos de outro tenant.
8. Imprima/salve o documento como PDF pelo navegador e confirme que a assinatura disponível é simples, não ICP-Brasil.

**Atenção:** a Matriz Contratual de Alocação de Riscos é separada do Mapa de Análise de Riscos e só deve ser utilizada após avaliação de sua cabimento/necessidade no caso concreto.

## 5. Validar usuários e permissões

1. Crie mais duas contas municipais em janelas anônimas e confirme seus e-mails.
2. Na Secretaria de teste, vincule uma delas como Operador e outra como Consulta.
3. Confirme que Operador pode consultar/cadastrar fornecedores, mas não editar nem inativar.
4. Confirme que Consulta só visualiza os módulos autorizados.
5. Como Administrador local, altere o papel de um membro e suspenda/reative um vínculo.
6. Verifique que o sistema impede suspender a própria conta e remover o último Administrador ativo.

## 6. Validar separação entre Secretarias

1. Crie uma segunda Secretaria de teste com outra conta municipal.
2. Cadastre fornecedores e documentos em ambas.
3. Entre em cada conta e confira que somente os registros da própria Secretaria aparecem.
4. Tente usar IDs de registros da outra Secretaria em operações diretas; o banco deve negar a leitura e a alteração.

## 7. Conferir painel, configurações e histórico

1. Confira os indicadores do painel com os registros de teste.
2. Atualize dados institucionais da Secretaria e verifique CNPJ, e-mail, telefone, endereço, município e UF.
3. Consulte o histórico e verifique os eventos de criação, edição, arquivamento, alteração de papel e assinatura.
4. Confirme que um usuário sem a permissão correspondente não consegue executar a operação, mesmo tentando chamar a API diretamente.

## Limites conhecidos desta versão

- Arquivos de documentos são referenciados por URL externa. O reconhecimento de um link do Google Drive guarda o ID do arquivo, mas a autorização OAuth e a sincronização automática com pastas do Drive ainda precisam ser configuradas.
- A geração de PDF utiliza a função de impressão do navegador.
- A assinatura disponível é eletrônica simples, vinculada à conta autenticada; não é certificado ICP-Brasil nem assinatura qualificada.
- Alertas de vencimento são exibidos no painel e na listagem; envio automático de e-mail/WhatsApp ainda precisa de um provedor e configuração.
- A proteção de senhas vazadas do Supabase Auth deve ser ativada antes de produção.

Não use dados pessoais reais nos primeiros testes. Prefira fornecedores e documentos fictícios de homologação.
