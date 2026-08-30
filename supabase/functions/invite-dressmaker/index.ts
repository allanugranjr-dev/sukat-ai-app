import { adminClient, AuthRequiredError, randomToken, requireUser, sha256 } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse, optionsResponse } from "../_shared/cors.ts";

const canonicalAppUrl = "https://sukat-ai-app.vercel.app";

function allowedInvitationOrigins(): string[] {
  const configured = Deno.env.get("INVITATION_ALLOWED_ORIGINS")?.trim() || Deno.env.get("SUPABASE_SITE_URL")?.trim() || "";
  return [...configured.split(","), canonicalAppUrl].map((value) => {
    try {
      const url = new URL(value.trim());
      return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
    } catch {
      return "";
    }
  }).filter(Boolean).filter((origin, index, origins) => origins.indexOf(origin) === index);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to create an invitation." }, 405);
  try {
    const client = adminClient();
    const user = await requireUser(request, client);
    const { data: actor, error: actorError } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (actorError || actor?.role !== "admin") return jsonResponse({ error: "Administrator access is required." }, 403);

    let body: { email?: string; organizationId?: string; redirectTo?: string };
    try {
      body = await request.json() as { email?: string; organizationId?: string; redirectTo?: string };
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
    const email = body.email?.trim().toLowerCase() ?? "";
    const organizationId = body.organizationId?.trim() ?? "";
    if (!email || !organizationId) return jsonResponse({ error: "Email and organization are required." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Enter a valid email address." }, 400);

    const { data: organization, error: organizationError } = await client.from("organizations").select("id").eq("id", organizationId).single();
    if (organizationError || !organization) return jsonResponse({ error: "That organization does not exist." }, 400);

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(body.redirectTo || `${canonicalAppUrl}/`, request.url);
    } catch {
      return jsonResponse({ error: "The invitation redirect URL is invalid." }, 400);
    }
    if (!['http:', 'https:'].includes(redirectUrl.protocol)) return jsonResponse({ error: "The invitation redirect URL is invalid." }, 400);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(redirectUrl.origin)) {
      redirectUrl = new URL(`${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`, `${canonicalAppUrl}/`);
    }
    const allowedOrigins = allowedInvitationOrigins();
    if (allowedOrigins.length === 0) return jsonResponse({ error: "Invitation redirect origins are not configured on the server." }, 500);
    if (!allowedOrigins.includes(redirectUrl.origin)) return jsonResponse({ error: "The invitation redirect URL is not an allowed application origin." }, 400);
    const rawToken = randomToken();
    const tokenParameter = redirectUrl.searchParams.has("token") ? "token" : "invite";
    redirectUrl.searchParams.set(tokenParameter, rawToken);
    const inviteUrl = redirectUrl.toString();
    const { data: invitation, error: invitationError } = await client.from("dressmaker_invitations").insert({
      organization_id: organizationId,
      email,
      token_hash: await sha256(rawToken),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invited_by: user.id,
    }).select("id").single();
    if (invitationError || !invitation) return jsonResponse({ error: invitationError?.message ?? "The invitation could not be created." }, 400);

    const { data: invitedUser, error: authError } = await client.auth.admin.inviteUserByEmail(email, {
      data: { invitation_id: invitation.id },
      redirectTo: inviteUrl,
    });
    if (authError || !invitedUser.user) {
      await client.from("dressmaker_invitations").delete().eq("id", invitation.id);
      return jsonResponse({ error: authError?.message ?? "Supabase did not create the invited account." }, 400);
    }

    // Keep a server-owned copy as a fallback for callbacks whose email template
    // drops the custom query string. app_metadata cannot be edited by the user.
    const { error: metadataError } = await client.auth.admin.updateUserById(invitedUser.user.id, {
      app_metadata: {
        ...(invitedUser.user.app_metadata ?? {}),
        sukat_ai_invitation_id: invitation.id,
      },
    });
    if (metadataError) {
      await client.from("dressmaker_invitations").delete().eq("id", invitation.id);
      return jsonResponse({ error: metadataError.message }, 400);
    }
    return new Response(JSON.stringify({ invitation_id: invitation.id, invite_url: inviteUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invitation service failed." }, error instanceof AuthRequiredError ? 401 : 500);
  }
});
