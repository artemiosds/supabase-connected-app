import type { Json } from "@/integrations/supabase/types";

/** Reproduces the server's exact placeholder merge before selecting a binary source. */
export function valuesForUneditedSource(
  templateContent: string,
  documentContent: string,
  snapshot: Json,
): Record<string, string> | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const entries = Object.entries(snapshot);
  if (entries.some(([, value]) => typeof value !== "string")) return null;
  const values = Object.fromEntries(entries) as Record<string, string>;
  const merged = entries.reduce(
    (body, [key, value]) => body.replaceAll(`{{${key}}}`, value as string),
    templateContent,
  );
  return merged === documentContent ? values : null;
}
