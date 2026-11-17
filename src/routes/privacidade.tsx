/* eslint-disable prettier/prettier -- legal copy is intentionally kept as readable prose. */
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — PRIMUS TECNOLOGIA E GESTÃO" },
      { name: "description", content: "Como a PRIMUS TECNOLOGIA E GESTÃO trata dados pessoais na plataforma PRIMUSGESTAO." },
    ],
  }),
  component: PoliticaPrivacidade,
});

function PoliticaPrivacidade() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <Link to="/" className="text-sm font-medium text-primary hover:underline">← Voltar ao início</Link>
        <header className="mt-8 border-b pb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">PRIMUS TECNOLOGIA E GESTÃO</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Política de Privacidade</h1>
          <p className="mt-3 text-sm text-muted-foreground">Versão preliminar — 17 de novembro de 2026</p>
          <p className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm leading-6">
            <strong>Documento em validação:</strong> os dados de identificação e contato do fornecedor foram preenchidos com as informações fornecidas pelo titular. Antes de adotar esta política como documento oficial ou cadastrá-la no Google OAuth, revise juridicamente os papéis de controlador e operador, os prazos de retenção, os provedores efetivamente utilizados e os procedimentos operacionais descritos.
          </p>
        </header>

        <article className="prose prose-neutral mt-8 max-w-none dark:prose-invert prose-headings:tracking-tight prose-p:leading-7">
          <h2>1. Escopo e papéis no tratamento</h2>
          <p>A plataforma PRIMUSGESTAO é disponibilizada sob a marca PRIMUS TECNOLOGIA E GESTÃO, cujo titular e responsável informado é ARTEMIO SILVA DE SOUZA, pessoa física. A plataforma apoia a gestão administrativa de fornecedores, documentos, processos, contratos e atividades relacionadas à gestão pública da saúde. A plataforma pode ser utilizada por diferentes Secretarias e organizações, cada qual em seu ambiente.</p>
          <p>Em regra, a organização cliente que insere e administra dados de fornecedores, representantes e documentos define as finalidades e instruções do tratamento desses dados e atua como controladora. O fornecedor que opera a plataforma poderá atuar como operador desses dados, conforme o contrato e as instruções legítimas da organização cliente. Para dados necessários à administração da própria plataforma, segurança, suporte e cumprimento de obrigações legais, o fornecedor poderá atuar como controlador independente. A definição final depende dos contratos e da operação efetivamente adotada.</p>
          <p><strong>Responsável informado pela plataforma:</strong> ARTEMIO SILVA DE SOUZA, pessoa física, titular da marca PRIMUS TECNOLOGIA E GESTÃO. CPF: 047.782.792-63. Endereço para contato: Rua Padre José Nicolino de Souza, 1440, bairro São Pedro, Oriximiná, Pará, Brasil.</p>

          <h2>2. Dados que podem ser tratados</h2>
          <ul>
            <li>Dados de conta e acesso: nome, e-mail, identificadores de usuário, organização, perfil e permissões.</li>
            <li>Dados administrativos de fornecedores e seus representantes, conforme os registros inseridos pela organização cliente.</li>
            <li>Documentos, contratos, processos, anexos, modelos e metadados associados às atividades da organização.</li>
            <li>Registros técnicos e de auditoria, como eventos de acesso e operação, data/hora, identificadores e informações necessárias à segurança e rastreabilidade.</li>
            <li>Solicitações de titulares relacionadas a acesso, correção, exportação, exclusão ou oposição.</li>
          </ul>
          <p>O sistema não deve receber dados pessoais excessivos ou dados sensíveis sem necessidade, finalidade legítima, base legal e autorização institucional adequadas. A organização cliente é responsável por avaliar os dados que insere e por fornecer os avisos pertinentes aos titulares.</p>

          <h2>3. Finalidades e bases legais</h2>
          <p>Os dados podem ser utilizados para autenticar usuários, administrar organizações e permissões, executar funcionalidades contratadas, organizar documentos e processos, manter histórico e auditoria, prestar suporte, prevenir fraude e incidentes, cumprir obrigações legais e atender solicitações de titulares. A base legal aplicável deve ser definida pelo controlador de cada operação, conforme a LGPD, podendo incluir cumprimento de obrigação legal, execução de contrato, exercício regular de direitos, legítimo interesse quando cabível e outras hipóteses legalmente aplicáveis.</p>

          <h2>4. Armazenamento, infraestrutura e Google Drive</h2>
          <p>A plataforma utiliza serviços de infraestrutura e banco de dados Supabase para funcionalidades de autenticação, dados e serviços de aplicação. A disponibilidade de recursos e a localização efetiva do armazenamento dependem da configuração contratada do projeto e dos provedores utilizados.</p>
          <p>Quando a organização habilitar a integração com Google Drive, a aplicação poderá solicitar autorização OAuth e sincronizar arquivos abrangidos pela integração para a pasta configurada pela própria organização. A integração utiliza o escopo <code>drive.file</code>, que limita o acesso aos arquivos criados pela aplicação ou selecionados/abertos pelo usuário com ela; não representa autorização geral para ler todo o Drive. A organização deve revisar a conta Google, a pasta de destino e as permissões concedidas.</p>
          <p>Google e Supabase tratam dados conforme seus próprios termos e políticas, além das configurações e contratos aplicáveis. A integração com terceiros pode permanecer desativada e não deve ser considerada disponível até ser configurada e testada.</p>

          <h2>5. Compartilhamento</h2>
          <p>Os dados podem ser acessados por usuários autorizados da organização correspondente e por provedores técnicos estritamente necessários à hospedagem, operação, segurança e integrações habilitadas. O acesso de suporte deve observar autorização, necessidade e controles aplicáveis. A plataforma não deve comercializar dados pessoais. Compartilhamentos adicionais dependem de finalidade legítima, instrução do controlador ou obrigação legal.</p>

          <h2>6. Segurança e isolamento</h2>
          <p>São adotados controles técnicos e organizacionais compatíveis com a arquitetura do serviço, incluindo autenticação, permissões por perfil, segregação lógica entre organizações, políticas de acesso no banco de dados e registros de auditoria. Nenhum sistema é absolutamente livre de riscos; incidentes devem ser tratados conforme a legislação, os contratos e os procedimentos aplicáveis.</p>

          <h2>7. Retenção e descarte</h2>
          <p>Os dados são mantidos pelo período necessário às finalidades do tratamento, às instruções da organização controladora, aos prazos legais e à preservação de registros e direitos. O prazo concreto pode variar conforme o tipo de dado, contrato, política de retenção e obrigações da organização. O encerramento de uma conta ou solicitação de exclusão não significa necessariamente eliminação imediata de todos os registros, cópias de segurança ou evidências que devam ser preservadas legalmente.</p>

          <h2>8. Direitos dos titulares</h2>
          <p>Os titulares podem exercer os direitos previstos na LGPD perante o controlador responsável pelo tratamento, incluindo confirmação, acesso, correção, anonimização, bloqueio, eliminação quando cabível, portabilidade nos termos da regulamentação, informação sobre compartilhamentos e revisão de decisões automatizadas quando aplicável.</p>
          <p>Solicitações relacionadas a dados inseridos por uma Secretaria devem ser encaminhadas inicialmente à própria organização controladora. A plataforma disponibiliza mecanismos internos para registrar e analisar solicitações, mas o registro de um pedido não significa que a exclusão, exportação ou outra providência tenha sido automaticamente executada. O controlador deve avaliar, decidir e efetivar a resposta cabível.</p>
          <p><strong>Canal de privacidade do fornecedor:</strong> artemiosouza99@gmail.com. Para dados tratados sob responsabilidade da organização cliente, contate também o encarregado ou canal oficial dessa organização.</p>

          <h2>9. Transferências internacionais</h2>
          <p>Provedores de infraestrutura ou integrações podem processar dados em outros países, conforme a região de hospedagem, arquitetura e termos dos serviços contratados. Antes da operação com dados reais, o controlador deve verificar os provedores, a localização do tratamento e os mecanismos de transferência internacional aplicáveis à LGPD e à regulamentação da ANPD.</p>

          <h2>10. Alterações e contato</h2>
          <p>Esta política poderá ser atualizada para refletir mudanças no serviço, nos provedores ou nas exigências legais. A versão vigente deverá indicar a data de atualização e ser comunicada às organizações clientes quando a alteração for relevante.</p>
          <p><strong>Identificação e contato do fornecedor:</strong> ARTEMIO SILVA DE SOUZA, pessoa física, titular da marca PRIMUS TECNOLOGIA E GESTÃO. CPF: 047.782.792-63. Endereço: Rua Padre José Nicolino de Souza, 1440, bairro São Pedro, Oriximiná, Pará, Brasil. E-mail: artemiosouza99@gmail.com.</p>
        </article>
      </div>
    </main>
  );
}
