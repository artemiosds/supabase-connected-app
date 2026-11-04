# Roteiro de validação do MVP

Este roteiro é para testar o sistema com contas e registros de teste reais, sem compartilhar credenciais.

## 1. Preparar os usuários

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

## 4. Validar usuários e permissões

1. Crie mais duas contas municipais em janelas anônimas e confirme seus e-mails.
2. Na Secretaria de teste, vincule uma delas como Operador e outra como Consulta.
3. Confirme que Operador pode consultar/cadastrar fornecedores, mas não editar nem inativar.
4. Confirme que Consulta só visualiza os módulos autorizados.
5. Como Administrador local, altere o papel de um membro e suspenda/reative um vínculo.
6. Verifique que o sistema impede suspender a própria conta e remover o último Administrador ativo.

## 5. Validar separação entre Secretarias

1. Crie uma segunda Secretaria de teste com outra conta municipal.
2. Cadastre fornecedores e documentos em ambas.
3. Entre em cada conta e confira que somente os registros da própria Secretaria aparecem.
4. Tente usar IDs de registros da outra Secretaria em operações diretas; o banco deve negar a leitura e a alteração.

## Limites conhecidos desta versão

- Arquivos de documentos são referenciados por URL externa. O reconhecimento de um link do Google Drive guarda o ID do arquivo, mas a autorização OAuth e a sincronização automática com pastas do Drive ainda precisam ser configuradas.
- A geração de PDF utiliza a função de impressão do navegador.
- A assinatura disponível é eletrônica simples, vinculada à conta autenticada; não é certificado ICP-Brasil nem assinatura qualificada.
- Alertas de vencimento são exibidos no painel e na listagem; envio automático de e-mail/WhatsApp ainda precisa de um provedor e configuração.
- A proteção de senhas vazadas do Supabase Auth deve ser ativada antes de produção.

Não use dados pessoais reais nos primeiros testes. Prefira fornecedores e documentos fictícios de homologação.
