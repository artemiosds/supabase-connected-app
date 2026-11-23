import { describe, expect, it } from "vitest";
import { renderInstitutionalEmail } from "../../supabase/functions/_shared/institutional-email.ts";

describe("e-mails institucionais do Primus", () => {
  const base = {
    issuer: "Secretaria Municipal de Saúde",
    category: "Comunicado oficial",
    heading: "Aviso de vencimento",
    preheader: "Registro com prazo próximo",
    message: "Favor verificar a documentação no sistema.",
    fields: [{ label: "Contrato", value: "Nº 123/2026" }],
    action: { label: "Consultar no Primus Gestão", url: "https://primus.example/contratos" },
  };

  it("apresenta estrutura institucional responsiva e dados administrativos", () => {
    const html = renderInstitutionalEmail(base);
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("PRIMUS GESTÃO");
    expect(html).toContain("Secretaria Municipal de Saúde");
    expect(html).toContain("123/2026");
    expect(html).toContain('href="https://primus.example/contratos"');
    expect(html).toContain("Comunicado oficial");
    expect(html).toContain("Comunicação automática");
  });

  it("protege contra HTML externo em assunto, campos e destinatários", () => {
    const html = renderInstitutionalEmail({
      ...base,
      issuer: "<img src=x onerror=alert(1)>",
      heading: '<script>alert("X")</script>',
      preheader: "</div><script>evil()</script>",
      fields: [{ label: "<b>Fornecedor</b>", value: "<script>exfiltrar()</script>" }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;Fornecedor&lt;/b&gt;");
  });

  it("não cria link clicável se o protocolo for inseguro", () => {
    const html = renderInstitutionalEmail({
      ...base,
      action: { label: "Acessar", url: "javascript:alert(1)" },
    });
    expect(html).not.toContain('href="javascript:');
  });

  it("reserva espaço para brasão embutido somente quando houver anexo", () => {
    const html = renderInstitutionalEmail(base);
    expect(html).toContain("<!--primus-institutional-logo-->");
    expect(html.replace("<!--primus-institutional-logo-->", '<img src="cid:brasao">')).toContain(
      'src="cid:brasao"',
    );
  });
});
