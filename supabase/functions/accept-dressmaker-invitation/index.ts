import { adminClient, AuthRequiredError, requireUser, sha256 } from "../_shared/auth.ts";
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  try {
    const client = adminClient();
    const user = await requireUser(request, client);
    const body = await request.json() as { token?: string; firstName?: string; lastName?: string };
    const token = body.token?.trim() ?? "";
    const firstName = body.firstName?.trim() ?? "";
    const lastName = body.lastName?.trim() ?? "";
    if (!token || !firstName || !lastName) return jsonResponse({ error: "Invitation token and name are required." }, 400);

    const { data: invitation, error: invitationError } = await client.from("dressmaker_invitations").select("*").eq("token_hash", await sha256(token)).maybeSingle();
    if (invitationError || !invitation) return jsonResponse({ error: "This invitation is invalid or has already been used." }, 400);
    if (invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() <= Date.now()) return jsonResponse({ error: "This invitation is no longer active." }, 400);
    if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) return jsonResponse({ error: "Sign in with the email address that received this invitation." }, 403);

    const { error: profileError } = await client.from("profiles").upsert({
      id: user.id,
      role: "dressmaker",
      organization_id: invitation.organization_id,
      first_name: firstName,
      last_name: lastName,
      email: user.email,
    }, { onConflict: "id" });
    if (profileError) return jsonResponse({ error: profileError.message }, 400);
    const { error: acceptError } = await client.from("dressmaker_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", invitation.id).is("accepted_at", null);
    if (acceptError) return jsonResponse({ error: acceptError.message }, 400);
    return jsonResponse({ accepted: true });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invitation acceptance failed." }, error instanceof AuthRequiredError ? 401 : 500);
  }
});
