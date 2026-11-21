import { useEffect, useId, useState } from "react";
import { loadMunicipalities, STATES } from "@/lib/cep";
import { Input } from "@/components/ui/input";
export function SupplierStateCity({
  state,
  city,
  onState,
  onCity,
}: {
  state: string;
  city: string;
  onState: (value: string) => void;
  onCity: (value: string) => void;
}) {
  const id = useId();
  const [cities, setCities] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setCities([]);
    if (!STATES.includes(state)) return;
    setStatus("Carregando municípios…");
    const timeout = setTimeout(() => controller.abort(), 4000);
    void loadMunicipalities(state, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setCities(rows);
          setStatus("");
        }
      })
      .catch(() => {
        setStatus("Consulta indisponível. Informe o município manualmente.");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [state]);
  return (
    <>
      <div className="space-y-2">
        <label htmlFor={id + "-uf"}>UF</label>
        <select
          id={id + "-uf"}
          className="h-10 w-full rounded-md border bg-background px-3"
          value={state}
          onChange={(e) => onState(e.target.value)}
        >
          <option value="">Selecione</option>
          {state && !STATES.includes(state) && <option>{state}</option>}
          {STATES.map((uf) => (
            <option key={uf}>{uf}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor={id + "-city"}>Município</label>
        <Input
          id={id + "-city"}
          list={id + "-cities"}
          value={city}
          onChange={(e) => onCity(e.target.value)}
        />
        <datalist id={id + "-cities"}>
          {cities.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {status && (
          <p className="text-xs text-muted-foreground" role="status">
            {status}
          </p>
        )}
      </div>
    </>
  );
}
