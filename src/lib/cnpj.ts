const PESOS_PRIMEIRO_DIGITO = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_SEGUNDO_DIGITO = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizarCnpj(valor: string): string {
  return valor.toUpperCase().replace(/[./\s-]/g, "");
}

export function validarCnpj(valor: string): boolean {
  const cnpj = normalizarCnpj(valor);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(.)\1{13}$/.test(cnpj)) return false;

  const calcularDigito = (base: string, pesos: number[]): number => {
    const soma = [...base].reduce(
      (total, caractere, indice) =>
        total + (caractere.charCodeAt(0) - 48) * pesos[indice],
      0,
    );
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const primeiro = calcularDigito(cnpj.slice(0, 12), PESOS_PRIMEIRO_DIGITO);
  if (Number(cnpj[12]) !== primeiro) return false;

  const segundo = calcularDigito(cnpj.slice(0, 13), PESOS_SEGUNDO_DIGITO);
  return Number(cnpj[13]) === segundo;
}

export function formatarCnpj(valor: string): string {
  const cnpj = valor.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
  if (cnpj.length <= 2) return cnpj;
  if (cnpj.length <= 5) return `${cnpj.slice(0, 2)}.${cnpj.slice(2)}`;
  if (cnpj.length <= 8) return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5)}`;
  if (cnpj.length <= 12) {
    return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8)}`;
  }
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
