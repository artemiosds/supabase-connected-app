# Cadastro da conta de recebimento da plataforma

## Onde acessar

Entre com a conta Administrador Master e abra **Painel Master → Cobrança**.

Esta é uma configuração global do SaaS: a conta cadastrada será a conta da plataforma, destinada futuramente a receber as mensalidades das Secretarias. Não é uma conta de pagamento individual de cada Secretaria.

## O que pode ser cadastrado

A tela aceita um provedor de cada vez:

- Mercado Pago;
- Stripe;
- Outro provedor (com nome informado manualmente).

Também permite escolher ambiente de teste (Sandbox) ou produção e informar nome do titular/conta, identificador do estabelecimento, e-mail, Client ID e chave pública quando aplicáveis.

Os campos privados aceitos na primeira versão são Access Token, Secret Key, Client Secret e segredo de assinatura do webhook. Os campos aplicáveis dependem do provedor escolhido. Não preencha uma chave privada no campo de chave pública.

## Proteção das credenciais

1. A tela envia os dados à Edge Function `platform-billing-config`, que exige JWT e confirma a identidade do usuário.
2. A função verifica se a conta é um Administrador Master ativo antes de usar o cliente administrativo do Supabase.
3. As credenciais privadas são armazenadas como um conjunto criptografado no Supabase Vault. A tabela da aplicação guarda apenas o identificador do segredo e metadados da conta.
4. A resposta do servidor informa apenas se há credenciais salvas. O segredo não é lido de volta para preencher a tela, não aparece na listagem, nem é registrado na auditoria.
5. Para substituir uma credencial, informe o novo valor no campo correspondente. Os campos privados vazios mantêm os valores já guardados.
6. Ao desconectar, a referência e o segredo privado do Vault são removidos. Metadados não sensíveis da conta podem continuar registrados para histórico administrativo.

**Não envie tokens, Secret Keys ou Client Secrets por chat, e-mail ou chamados de suporte.** Cadastre-os diretamente no Painel Master e use preferencialmente as credenciais de Sandbox durante os testes.

## O que ainda não é feito

Esta entrega é a camada de cadastro e armazenamento seguro. Ela **não**:
- abre uma autorização OAuth com o provedor;
- valida a chave consultando a API do gateway;
- cria clientes, cobranças, assinaturas, boletos ou links de pagamento;
- recebe, verifica ou processa webhooks;
- altera automaticamente os status comerciais das Secretarias;
- faz repasses, estornos ou conciliação financeira.

A configuração aceita Mercado Pago, Stripe ou Outro, mas não existe um adaptador específico de cobrança ativo. O campo de processamento no banco permanece forçado como falso, inclusive quando as credenciais são cadastradas. Portanto, o sistema não fará cobranças acidentais.

Quando o provedor for escolhido, a próxima etapa será implementar e homologar o adaptador daquele provedor: autorização ou validação de credenciais, produtos/planos, assinaturas, cobrança recorrente, webhooks assinados, idempotência, retentativas, conciliação e regras de inadimplência/cancelamento. Só depois de testes em Sandbox deverá haver uma liberação separada para pagamentos reais.

## Situação inicial do SMS2

A tabela de configuração está criada e protegida, mas ainda não há conta cadastrada, nenhuma credencial real no Vault e nenhum pagamento ativo. A decisão do provedor permanece em aberto.
