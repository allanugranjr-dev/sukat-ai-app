import { adminClient, AuthRequiredError, requireUser, sha256 } from "../_shared/auth.ts";
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to accept an invitation." }, 405);
  try {
    const client = adminClient();
    const user = await requireUser(request, client);
    let body: { token?: string; firstName?: string; lastName?: string };
    try {
      body = await request.json() as { token?: string; firstName?: string; lastName?: string };
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
    const token = body.token?.trim() ?? "";
    const firstName = body.firstName?.trim() ?? "";
    const lastName = body.lastName?.trim() ?? "";
    if (!token || !firstName || !lastName || firstName.length > 80 || lastName.length > 80) return jsonResponse({ error: "Invitation token and name are required." }, 400);

    const { data: invitation, error: invitationError } = await client.from("dressmaker_invitations").select("*").eq("token_hash", await sha256(token)).maybeSingle();
    if (invitationError || !invitation) return jsonResponse({ error: "This invitation is invalid or has already been used." }, 400);
    if (invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "This invitation is no longer active." }, 400);
    if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) return jsonResponse({ error: "Sign in with the email address that received this invitation." }, 403);

    const { data: existingProfile, error: existingProfileError } = await client.from("profiles").select("role,organization_id").eq("id", user.id).maybeSingle();
    if (existingProfileError) return jsonResponse({ error: existingProfileError.message }, 400);
    if (existingProfile && existingProfile.role !== "customer" && !(existingProfile.role === "dressmaker" && existingProfile.organization_id === invitation.organization_id)) {
      return jsonResponse({ error: "This account cannot accept a dressmaker invitation." }, 403);
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
    if (claimError) return jsonResponse({ error: claimError.message }, 400);
    if (!claimedInvitation) return jsonResponse({ error: "This invitation is invalid or has already been used." }, 400);

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
      return jsonResponse({ error: profileError.message }, 400);
    }
    return jsonResponse({ accepted: true });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invitation acceptance failed." }, error instanceof AuthRequiredError ? 401 : 500);
  }
});
