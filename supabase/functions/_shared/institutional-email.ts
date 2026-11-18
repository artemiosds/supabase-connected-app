import { escapeHtml } from "./expiry-notification.ts";

/** Modelo único dos e-mails operacionais do Primus. Dados externos são sempre escapados. */
export type InstitutionalEmailField = { label: string; value: string };
export type InstitutionalEmailTone = "standard" | "attention" | "critical" | "success";
export type InstitutionalEmailOptions = {
  issuer: string;
  category: string;
  heading: string;
  preheader: string;
  greeting?: string;
  message: string;
  fields?: InstitutionalEmailField[];
  action?: { label: string; url: string };
  guidance?: string;
  logoCid?: boolean;
  tone?: InstitutionalEmailTone;
};

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function renderInstitutionalEmail(options: InstitutionalEmailOptions): string {
  const tone = options.tone ?? "standard";
  const accent = tone === "critical" ? "#B42318" : tone === "attention" ? "#9A6700" :
    tone === "success" ? "#087F5B" : "#176B9B";
  const escaped = (value: string) => escapeHtml(value);
  const safeUrl = options.action ? safeHttpUrl(options.action.url) : null;
  const logo = options.logoCid
    ? '<img src="cid:brasao" width="64" alt="Brasão institucional" style="display:block;border:0;max-height:70px;max-width:64px;width:auto;height:auto;margin:0 0 12px">'
    : "";
  const fields = options.fields?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:20px 0 24px;border:1px solid #E3EAF2;border-radius:8px;background:#F7F9FC;">${options.fields.map(
        ({ label, value }, index) => `<tr><td style="padding:12px 16px;vertical-align:top;border-bottom:${index === options.fields!.length - 1 ? "0" : "1px solid #E3EAF2"};font:13px/1.5 Arial,Helvetica,sans-serif;color:#536476;width:38%;">${escaped(label)}</td><td style="padding:12px 16px;vertical-align:top;border-bottom:${index === options.fields!.length - 1 ? "0" : "1px solid #E3EAF2"};font:600 14px/1.5 Arial,Helvetica,sans-serif;color:#172F49;overflow-wrap:anywhere;">${escaped(value)}</td></tr>`
      ).join("")}</table>`
    : "";
  const action = options.action && safeUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td bgcolor="#164B70" style="border-radius:6px;"><a href="${escaped(safeUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#164B70;border:1px solid #164B70;border-radius:6px;padding:13px 20px;color:#FFFFFF;text-decoration:none;font:700 14px/1.4 Arial,Helvetica,sans-serif;">${escaped(options.action.label)}</a></td></tr></table>`
    : "";
  const guidance = options.guidance
    ? `<p style="margin:22px 0 0;padding:14px 16px;border-left:3px solid ${accent};background:#F5F8FC;color:#344A62;font:14px/1.65 Arial,Helvetica,sans-serif;">${escaped(options.guidance)}</p>`
    : "";

  return [
    "<!doctype html>",
    '<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light"><style>@media screen and (max-width:640px){.primus-pad{padding:24px 20px!important}.primus-title{font-size:23px!important}}</style></head>',
    '<body style="margin:0;padding:0;background:#F0F4F8;color:#1B3046;-webkit-text-size-adjust:100%;font-family:Arial,Helvetica,sans-serif;">',
    `<div style="display:none;font-size:1px;line-height:1px;color:#F0F4F8;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escaped(options.preheader)}</div>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F0F4F8" style="border-collapse:collapse;"><tr><td align="center" style="padding:28px 12px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;max-width:620px;background:#FFFFFF;">',
    '<tr><td class="primus-pad" bgcolor="#102D4A" style="padding:30px 36px 26px;border-bottom:4px solid #D6B36A;">',
    logo,
    '<p style="margin:0 0 6px;font:700 12px/1.5 Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#E7C680;">PRIMUS GESTÃO</p>',
    `<p style="margin:0;font:600 16px/1.5 Arial,Helvetica,sans-serif;color:#FFFFFF;overflow-wrap:anywhere;">${escaped(options.issuer)}</p>`,
    '</td></tr>',
    '<tr><td class="primus-pad" style="padding:34px 36px 30px;">',
    `<p style="margin:0 0 12px;font:700 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:${accent};">${escaped(options.category)}</p>`,
    `<h1 class="primus-title" style="font:700 27px/1.25 Arial,Helvetica,sans-serif;letter-spacing:-0.4px;color:#153550;margin:0 0 21px;">${escaped(options.heading)}</h1>`,
    `<p style="font:15px/1.7 Arial,Helvetica,sans-serif;color:#294159;margin:0 0 14px;">${escaped(options.greeting ?? "Prezado(a),")}</p>`,
    `<p style="font:15px/1.75 Arial,Helvetica,sans-serif;color:#294159;margin:0 0 18px;">${escaped(options.message)}</p>`,
    fields, guidance, action,
    '<p style="margin:26px 0 0;font:13px/1.65 Arial,Helvetica,sans-serif;color:#617388;">Esta comunicação apoia o acompanhamento administrativo. Para conferir informações e adotar providências, consulte os registros oficiais no Primus Gestão.</p>',
    '</td></tr>',
    '<tr><td class="primus-pad" bgcolor="#F6F8FB" style="padding:22px 36px;border-top:1px solid #E5EAF1;">',
    `<p style="margin:0 0 5px;font:700 12px/1.5 Arial,Helvetica,sans-serif;color:#34516E;">${escaped(options.issuer)}</p>`,
    '<p style="margin:0;font:12px/1.6 Arial,Helvetica,sans-serif;color:#677B8F;">Comunicação automática do Primus Gestão — Gestão de Fornecedores da Saúde. Em caso de dúvida, procure a administração responsável pela sua unidade.</p>',
    '</td></tr></table></td></tr></table>',
    '</body></html>',
  ].join("");
}
