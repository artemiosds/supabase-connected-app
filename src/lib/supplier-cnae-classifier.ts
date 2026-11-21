export function classifySupplierCnae(code: string | null | undefined) {
  const digits = (code ?? "").replace(/\D/g, "");
  if (/^(46443|47717)/.test(digits)) return "medicamentos";
  if (/^(46451|47733)/.test(digits)) return "materiais_hospitalares";
  if (/^(46648|33131)/.test(digits)) return "equipamentos";
  if (/^(86|77)/.test(digits)) return "servicos";
  return "outros";
}
