export type Address = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
};
export const STATES =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export function normalizeCep(value: string) {
  return value.replace(/\D/g, "");
}

export async function lookupCep(value: string, fetcher: typeof fetch = fetch): Promise<Address> {
  const cep = normalizeCep(value);
  if (!/^\d{8}$/.test(cep)) throw new Error("Informe um CEP com 8 dígitos.");
  const controllers = [new AbortController(), new AbortController()];
  const sources = [
    "https://brasilapi.com.br/api/cep/v1/" + cep,
    "https://viacep.com.br/ws/" + cep + "/json/",
  ];
  const requests = sources.map(async (url, index) => {
    const controller = controllers[index]!;
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) throw new Error("CEP indisponível.");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("Resposta inválida.");
      const d = data as Record<string, unknown>;
      const text = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : "");
      const city = text("city") || text("localidade");
      const state = text("state") || text("uf");
      if (!city || !STATES.includes(state) || normalizeCep(text("cep")) !== cep)
        throw new Error("CEP não encontrado.");
      return {
        street: text("street") || text("logradouro"),
        neighborhood: text("neighborhood") || text("bairro"),
        city,
        state,
        postal_code: cep,
      };
    } finally {
      clearTimeout(timer);
    }
  });
  try {
    return await Promise.any(requests);
  } finally {
    controllers.forEach((controller) => controller.abort());
  }
}

export async function loadMunicipalities(state: string, signal: AbortSignal): Promise<string[]> {
  if (!STATES.includes(state)) return [];
  const response = await fetch(
    "https://servicodados.ibge.gov.br/api/v1/localidades/estados/" +
      state +
      "/municipios?orderBy=nome",
    { signal },
  );
  if (!response.ok) throw new Error("Municípios indisponíveis.");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Resposta inválida.");
  return data.flatMap((entry: unknown) =>
    entry && typeof entry === "object" && "nome" in entry && typeof entry.nome === "string"
      ? [entry.nome]
      : [],
  );
}
