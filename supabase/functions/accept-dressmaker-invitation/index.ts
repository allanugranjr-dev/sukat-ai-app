import { adminClient, AuthRequiredError, requireUser, sha256 } from "../_shared/auth.ts";
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to accept an invitation." }, 405, request);
  try {
    const client = adminClient();
    const user = await requireUser(request, client);
    let body: { token?: string; firstName?: string; lastName?: string };
    try {
      const parsed = await request.json() as unknown;
      if (!isRecord(parsed)) throw new Error();
      body = parsed as { token?: string; firstName?: string; lastName?: string };
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400, request);
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const serverInvitationId = typeof user.app_metadata?.sukat_ai_invitation_id === "string" ? user.app_metadata.sukat_ai_invitation_id.trim() : "";
    const legacyInvitationId = typeof user.user_metadata?.invitation_id === "string" ? user.user_metadata.invitation_id.trim() : "";
    const invitationId = serverInvitationId || legacyInvitationId;
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    if ((!token && !invitationId) || !firstName || !lastName || firstName.length > 80 || lastName.length > 80) return jsonResponse({ error: "Open the invitation link again, then enter your name." }, 400, request);

    const invitationQuery = client.from("dressmaker_invitations").select("*");
    const { data: invitation, error: invitationError } = token
      ? await invitationQuery.eq("token_hash", await sha256(token)).maybeSingle()
      : await invitationQuery.eq("id", invitationId).maybeSingle();
    if (invitationError || !invitation) return jsonResponse({ error: "This invitation is invalid or has already been used." }, 400, request);
    if (invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "This invitation is no longer active." }, 400, request);
    if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) return jsonResponse({ error: "Sign in with the email address that received this invitation." }, 403, request);

    const { data: existingProfile, error: existingProfileError } = await client.from("profiles").select("role,organization_id").eq("id", user.id).maybeSingle();
    if (existingProfileError) return jsonResponse({ error: "The invitation could not be accepted." }, 400, request);
    if (existingProfile && existingProfile.role !== "customer" && !(existingProfile.role === "dressmaker" && existingProfile.organization_id === invitation.organization_id)) {
      return jsonResponse({ error: "This account cannot accept a dressmaker invitation." }, 403, request);
    }

    const acceptedAt = new Date().toISOString();
    const { data: claimedInvitation, error: claimError } = await client
      .from("dressmaker_invitations")
      .update({ accepted_at: acceptedAt })
      .eq("id", invitation.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (claimError) return jsonResponse({ error: "This invitation could not be claimed." }, 400, request);
    if (!claimedInvitation) return jsonResponse({ error: "This invitation is invalid or has already been used." }, 400, request);

    const { error: profileError } = await client.from("profiles").upsert({
      id: user.id,
      role: "dressmaker",
      organization_id: invitation.organization_id,
      first_name: firstName,
      last_name: lastName,
      email: user.email,
    }, { onConflict: "id" });
    if (profileError) {
      await client.from("dressmaker_invitations").update({ accepted_at: null }).eq("id", invitation.id).eq("accepted_at", acceptedAt);
      return jsonResponse({ error: "Your account could not be updated for this invitation." }, 400, request);
    }
    return jsonResponse({ accepted: true }, 200, request);
  } catch (error) {
    return jsonResponse({ error: error instanceof AuthRequiredError ? error.message : "Invitation acceptance failed." }, error instanceof AuthRequiredError ? 401 : 500, request);
  }
});
