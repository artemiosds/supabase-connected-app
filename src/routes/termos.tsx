/* eslint-disable prettier/prettier -- legal copy is intentionally kept as readable prose. */
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — PRIMUS TECNOLOGIA E GESTÃO" },
      { name: "description", content: "Condições preliminares de utilização da plataforma PRIMUSGESTAO, da marca PRIMUS TECNOLOGIA E GESTÃO." },
    ],
  }),
  component: TermosDeUso,
});

function TermosDeUso() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <Link to="/" className="text-sm font-medium text-primary hover:underline">← Voltar ao início</Link>
        <header className="mt-8 border-b pb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">PRIMUS TECNOLOGIA E GESTÃO</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Termos de Uso</h1>
          <p className="mt-3 text-sm text-muted-foreground">Versão preliminar — 17 de novembro de 2026</p>
          <p className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm leading-6">
            <strong>Documento em validação:</strong> a identificação do fornecedor foi preenchida com os dados informados pelo titular. Estes termos não substituem o contrato de prestação de serviços com cada organização. Antes da adoção oficial, devem ser definidos em instrumento próprio as condições comerciais, níveis de serviço, responsabilidades operacionais e procedimentos de encerramento, com revisão jurídica.
          </p>
        </header>

        <article className="prose prose-neutral mt-8 max-w-none dark:prose-invert prose-headings:tracking-tight prose-p:leading-7">
          <h2>1. Objeto e aceitação</h2>
          <p>A plataforma PRIMUSGESTAO é disponibilizada sob a marca PRIMUS TECNOLOGIA E GESTÃO, cujo titular e responsável informado é ARTEMIO SILVA DE SOUZA, pessoa física. O sistema apoia a gestão administrativa de fornecedores, documentos, processos, contratos e rotinas relacionadas à gestão pública da saúde. O acesso é destinado a organizações clientes e às pessoas por elas autorizadas. O uso da plataforma implica ciência destes termos e dos instrumentos específicos celebrados com a organização cliente, sem afastar as normas legais aplicáveis.</p>

          <h2>2. Contratação e organizações</h2>
          <p>O acesso institucional depende de contratação, habilitação ou autorização válida da organização cliente. Cada organização administra seus usuários, perfis e permissões, dentro dos limites do serviço. Condições de preço, prazo, suporte, disponibilidade, implantação, limites de uso e encerramento devem constar de proposta ou contrato próprio.</p>
          <p><strong>Fornecedor do serviço:</strong> ARTEMIO SILVA DE SOUZA, pessoa física, titular da marca PRIMUS TECNOLOGIA E GESTÃO. CPF: 047.782.792-63. Endereço: Rua Padre José Nicolino de Souza, 1440, bairro São Pedro, Oriximiná, Pará, Brasil. E-mail: artemiosouza99@gmail.com.</p>

          <h2>3. Contas e credenciais</h2>
          <p>O usuário deve fornecer informações corretas, manter suas credenciais em sigilo, utilizar autenticação de forma responsável e comunicar imediatamente suspeitas de uso indevido. É vedado compartilhar contas quando isso comprometer a identificação individual, os controles de acesso ou a auditoria. A organização cliente deve solicitar a revogação tempestiva dos acessos de pessoas que não precisem mais utilizar o sistema.</p>

          <h2>4. Uso permitido e responsabilidades da organização</h2>
          <p>A plataforma deve ser utilizada exclusivamente para finalidades legítimas e autorizadas da organização. A organização cliente é responsável por:</p>
          <ul>
            <li>definir usuários, perfis, permissões e responsáveis institucionais;</li>
            <li>verificar a exatidão, legitimidade, necessidade e atualização dos dados inseridos;</li>
            <li>possuir base legal e autorizações necessárias para tratar e compartilhar dados pessoais;</li>
            <li>fornecer avisos de privacidade aos titulares e atender suas solicitações como controladora, quando aplicável;</li>
            <li>revisar documentos, prazos, decisões administrativas e informações antes de utilizá-los oficialmente;</li>
            <li>manter cópias e registros exigidos por suas normas administrativas e legais.</li>
          </ul>

          <h2>5. Uso proibido</h2>
          <p>É proibido tentar acessar dados de outra organização sem autorização, contornar controles de segurança, realizar engenharia reversa ilícita, introduzir código malicioso, utilizar o serviço para fraude ou atividade ilegal, violar direitos de terceiros ou inserir dados sem autorização ou finalidade legítima.</p>

          <h2>6. Dados, privacidade e confidencialidade</h2>
          <p>O tratamento de dados pessoais é disciplinado pela Política de Privacidade e pela legislação aplicável, especialmente a LGPD. Em relação aos dados operacionais inseridos pela organização, os papéis de controlador e operador serão definidos conforme as finalidades, decisões efetivas e contrato. A organização deve evitar inserir dados pessoais sensíveis ou excessivos sem necessidade e fundamento jurídico adequado.</p>

          <h2>7. Integrações externas</h2>
          <p>Funcionalidades conectadas a serviços externos, como Google Drive, dependem de configuração, autorização e disponibilidade do respectivo provedor. A organização é responsável por escolher a conta e os locais de armazenamento, revisar permissões e observar os termos do terceiro. Integrações podem ser alteradas ou interrompidas pelo provedor, por revogação de autorização ou por razões de segurança.</p>

          <h2>8. Disponibilidade, manutenção e suporte</h2>
          <p>O fornecedor buscará manter o serviço operacional e aplicar medidas razoáveis de manutenção e segurança. Não se estabelece, por esta versão preliminar, percentual de disponibilidade, prazo de atendimento, janela de manutenção ou nível de serviço; esses compromissos devem constar do contrato específico. Podem ocorrer indisponibilidades por manutenção, falhas de provedores, conectividade, eventos de segurança ou força maior.</p>

          <h2>9. Propriedade intelectual</h2>
          <p>O software, sua identidade visual, componentes e materiais próprios permanecem protegidos pela legislação aplicável e pertencem aos respectivos titulares. A organização mantém seus direitos sobre os dados e documentos que inserir, concedendo apenas as permissões necessárias à prestação do serviço, conforme contrato e instruções legítimas.</p>

          <h2>10. Suspensão e encerramento</h2>
          <p>O acesso poderá ser suspenso ou encerrado nas hipóteses previstas em contrato, por solicitação da organização, risco relevante à segurança, uso ilícito ou obrigação legal. O encerramento deve observar os procedimentos contratuais de exportação, retenção, devolução e descarte de dados, preservando registros que devam ser mantidos por obrigação legal ou exercício regular de direitos.</p>

          <h2>11. Limites e responsabilidade</h2>
          <p>A plataforma é ferramenta de apoio administrativo e não substitui análise técnica, jurídica, contábil ou decisão formal da autoridade competente. A organização deve validar informações e documentos antes de utilizá-los em atos oficiais. A responsabilidade de cada parte será definida pela legislação e pelo contrato aplicável, considerando suas próprias ações, omissões e obrigações; nenhuma disposição exclui responsabilidade que não possa ser afastada por lei.</p>

          <h2>12. Alterações destes termos</h2>
          <p>Os termos poderão ser atualizados para refletir alterações do serviço ou exigências legais. Alterações relevantes deverão ser comunicadas às organizações clientes e, quando necessário, submetidas à aceitação conforme o contrato.</p>

          <h2>13. Lei aplicável e contato</h2>
          <p>Aplicam-se as leis da República Federativa do Brasil, observadas as regras de competência legalmente aplicáveis. Questões comerciais e operacionais devem ser tratadas pelos canais indicados no contrato de cada organização.</p>
          <p><strong>Contato do fornecedor:</strong> ARTEMIO SILVA DE SOUZA, pessoa física, titular da marca PRIMUS TECNOLOGIA E GESTÃO. CPF: 047.782.792-63. Endereço: Rua Padre José Nicolino de Souza, 1440, bairro São Pedro, Oriximiná, Pará, Brasil. E-mail: artemiosouza99@gmail.com.</p>
        </article>
      </div>
    </main>
  );
}
