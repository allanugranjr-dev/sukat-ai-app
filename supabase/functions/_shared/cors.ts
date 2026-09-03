const canonicalOrigin = "https://sukat-ai-app.vercel.app";
const localOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
];

function allowedOrigins(): Set<string> {
  const configured = (Deno.env.get("INVITATION_ALLOWED_ORIGINS") ?? Deno.env.get("SUPABASE_SITE_URL") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([canonicalOrigin, ...localOrigins, ...configured]);
}

function originFor(request?: Request): string | null {
  const origin = request?.headers.get("Origin")?.trim();
  if (!origin) return null;
  return allowedOrigins().has(origin) ? origin : null;
}

export function corsHeaders(request?: Request): Record<string, string> {
  const origin = originFor(request);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

export function optionsResponse(request: Request): Response {
  const requestOrigin = request.headers.get("Origin")?.trim();
  if (requestOrigin && !originFor(request)) {
    return jsonResponse({ error: "The request origin is not allowed." }, 403, request);
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonResponse(body: unknown, status = 200, request?: Request): Response {
  const requestOrigin = request?.headers.get("Origin")?.trim();
  const headers = corsHeaders(request);
  if (requestOrigin && !originFor(request)) {
    return new Response(JSON.stringify({ error: "The request origin is not allowed." }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
