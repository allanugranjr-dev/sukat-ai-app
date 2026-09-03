import { adminClient, AuthRequiredError, randomToken, requireUser, sha256 } from "../_shared/auth.ts";
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";

const canonicalAppUrl = "https://sukat-ai-app.vercel.app";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  if (request.method === "OPTIONS") return optionsResponse(request);
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to create an invitation." }, 405, request);
  try {
    const client = adminClient();
    const user = await requireUser(request, client);
    const { data: actor, error: actorError } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (actorError || actor?.role !== "admin") return jsonResponse({ error: "Administrator access is required." }, 403, request);

    let body: { email?: string; organizationId?: string; redirectTo?: string };
    try {
      const parsed = await request.json() as unknown;
      if (!isRecord(parsed)) throw new Error();
      body = parsed as { email?: string; organizationId?: string; redirectTo?: string };
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400, request);
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    if (!email || !organizationId) return jsonResponse({ error: "Email and organization are required." }, 400, request);
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "Enter a valid email address." }, 400, request);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) return jsonResponse({ error: "The organization is invalid." }, 400, request);
    if (body.redirectTo !== undefined && typeof body.redirectTo !== "string") return jsonResponse({ error: "The invitation redirect URL is invalid." }, 400, request);

    const { data: organization, error: organizationError } = await client.from("organizations").select("id").eq("id", organizationId).single();
    if (organizationError || !organization) return jsonResponse({ error: "That organization does not exist." }, 400, request);

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(body.redirectTo || `${canonicalAppUrl}/`, request.url);
    } catch {
      return jsonResponse({ error: "The invitation redirect URL is invalid." }, 400, request);
    }
    if (!['http:', 'https:'].includes(redirectUrl.protocol)) return jsonResponse({ error: "The invitation redirect URL is invalid." }, 400, request);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(redirectUrl.origin)) {
      redirectUrl = new URL(`${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`, `${canonicalAppUrl}/`);
    }
    const allowedOrigins = allowedInvitationOrigins();
    if (allowedOrigins.length === 0) return jsonResponse({ error: "Invitation redirect origins are not configured on the server." }, 500, request);
    if (!allowedOrigins.includes(redirectUrl.origin)) return jsonResponse({ error: "The invitation redirect URL is not an allowed application origin." }, 400, request);
    const { data: activeInvitation, error: activeInvitationError } = await client
      .from("dressmaker_invitations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (activeInvitationError) return jsonResponse({ error: "Existing invitations could not be checked." }, 500, request);
    if (activeInvitation) return jsonResponse({ error: "An active invitation already exists for this email address." }, 409, request);
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
    if (invitationError || !invitation) return jsonResponse({ error: "The invitation could not be created." }, 400, request);

    const { data: invitedUser, error: authError } = await client.auth.admin.inviteUserByEmail(email, {
      data: { invitation_id: invitation.id },
      redirectTo: inviteUrl,
    });
    const authErrorCode = typeof (authError as { code?: unknown } | null)?.code === "string"
      ? String((authError as { code?: unknown }).code)
      : "";
    const authErrorMessage = authError?.message ?? "";
    const isExistingAccount = authErrorCode === "email_exists" || /already been registered|already exists|email_exists/i.test(authErrorMessage);
    if (isExistingAccount) {
      return jsonResponse({
        invitation_id: invitation.id,
        invite_url: inviteUrl,
        email_status: "existing_account",
        email_error: "This email already has a SukatAI account. Supabase cannot send a second account invite, so share this secure link and ask the recipient to sign in with this email before accepting.",
      }, 200, request);
    }
    if (authError || !invitedUser?.user) {
      await client.from("dressmaker_invitations").delete().eq("id", invitation.id);
      return jsonResponse({ error: "Supabase did not create the invited account." }, 400, request);
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
      return jsonResponse({ error: "The invitation account could not be configured." }, 400, request);
    }
    return jsonResponse({ invitation_id: invitation.id, invite_url: inviteUrl, email_status: "sent", email_error: null }, 200, request);
  } catch (error) {
    return jsonResponse({ error: error instanceof AuthRequiredError ? error.message : "Invitation service failed." }, error instanceof AuthRequiredError ? 401 : 500, request);
  }
});
