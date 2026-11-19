import { useId, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatarCnpj, normalizarCnpj } from "@/lib/cnpj";

export type SupplierOption = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  city: string | null;
};

type Props = {
  suppliers: SupplierOption[];
  value: string;
  onValueChange: (id: string) => void;
  disabled?: boolean;
  emptyOption?: { value: string; label: string };
};

function searchable(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function SupplierSelect({ suppliers, value, onValueChange, disabled, emptyOption }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const listId = useId();
  const selected = suppliers.find((s) => s.id === value);
  const term = searchable(search);
  const document = normalizarCnpj(search);
  const matches = suppliers.filter(
    (s) =>
      !term ||
      searchable([s.legal_name, s.trade_name, s.city].join(" ")).includes(term) ||
      (document.length > 0 && s.cnpj?.includes(document)),
  );
  function choose(id: string) {
    onValueChange(id);
    setOpen(false);
    setSearch("");
  }
  return (
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          variant="outline"
          className="w-full min-w-0 justify-between"
        >
          <span className="truncate">
            {selected?.legal_name ??
              (value === emptyOption?.value ? emptyOption.label : "Selecione o fornecedor")}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Buscar fornecedor"
            placeholder="Nome, CNPJ ou município"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList id={listId}>
            <CommandEmpty>Nenhum fornecedor encontrado.</CommandEmpty>
            {emptyOption && !term && (
              <CommandItem value={emptyOption.value} onSelect={() => choose(emptyOption.value)}>
                {emptyOption.label}
              </CommandItem>
            )}
            {matches.map((s) => (
              <CommandItem
                key={s.id}
                value={s.id}
                aria-label={s.legal_name}
                onSelect={() => choose(s.id)}
                className="flex-col items-start"
              >
                <span>{s.legal_name}</span>
                <span className="text-xs text-muted-foreground">
                  {[s.trade_name, s.cnpj && formatarCnpj(s.cnpj), s.city]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
