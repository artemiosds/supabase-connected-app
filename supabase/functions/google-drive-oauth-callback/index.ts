import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4?target=deno";

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return new Response("Método não permitido.", { status: 405 });
  const appUrl = Deno.env.get("APP_URL");
  if (!appUrl) return new Response("Configuração de retorno ausente.", { status: 503 });
  const url = new URL("/configuracoes?drive=error&drive_reason=callback_pending", appUrl);
  return Response.redirect(url, 303);
});
