import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ThemeOption = "light" | "dark" | "system";

const THEME_OPTIONS = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Escuro", Icon: Moon },
  { value: "system", label: "Sistema", Icon: Monitor },
] as const;

function isThemeOption(value: string | undefined): value is ThemeOption {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Keep server and initial client markup identical to avoid hydration mismatches.
  const selected: ThemeOption = mounted && isThemeOption(theme) ? theme : "system";
  const current = THEME_OPTIONS.find((option) => option.value === selected)!;
  const Icon = current.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          specular={false}
          className="group size-9 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={`Selecionar tema. Atual: ${current.label}`}
          title={`Aparência: ${current.label}`}
        >
          <Icon
            className="h-4 w-4 transition-transform duration-200 ease-out motion-safe:group-hover:rotate-12"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Aparência</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map(({ value, label, Icon: OptionIcon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            aria-current={selected === value ? "true" : undefined}
            className="gap-2"
          >
            <OptionIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{label}</span>
            <Check
              className={`ml-auto h-4 w-4 text-primary ${
                selected === value ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden="true"
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
