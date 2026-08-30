import { adminClient, AuthRequiredError, randomToken, requireUser, sha256 } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse, optionsResponse } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  try {
    const client = adminClient();
    const user = await requireUser(request, client);
    const { data: actor, error: actorError } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (actorError || actor?.role !== "admin") return jsonResponse({ error: "Administrator access is required." }, 403);

    const body = await request.json() as { email?: string; organizationId?: string; redirectTo?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const organizationId = body.organizationId?.trim() ?? "";
    if (!email || !organizationId || !body.redirectTo) return jsonResponse({ error: "Email, organization, and redirect URL are required." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Enter a valid email address." }, 400);

    const { data: organization, error: organizationError } = await client.from("organizations").select("id").eq("id", organizationId).single();
    if (organizationError || !organization) return jsonResponse({ error: "That organization does not exist." }, 400);

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(body.redirectTo, request.url);
    } catch {
      return jsonResponse({ error: "The invitation redirect URL is invalid." }, 400);
    }
    if (!['http:', 'https:'].includes(redirectUrl.protocol)) return jsonResponse({ error: "The invitation redirect URL is invalid." }, 400);
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

    const { error: authError } = await client.auth.admin.inviteUserByEmail(email, {
      data: { invitation_id: invitation.id },
      redirectTo: inviteUrl,
    });
    if (authError) {
      await client.from("dressmaker_invitations").delete().eq("id", invitation.id);
      return jsonResponse({ error: authError.message }, 400);
    }
    return new Response(JSON.stringify({ invitation_id: invitation.id, invite_url: inviteUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invitation service failed." }, error instanceof AuthRequiredError ? 401 : 500);
  }
});
