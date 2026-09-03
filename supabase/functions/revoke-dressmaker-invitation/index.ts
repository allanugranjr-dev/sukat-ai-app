import { adminClient, AuthRequiredError, requireUser } from "../_shared/auth.ts";
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse(request);
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to remove an invitation." }, 405, request);
  try {
    const client = adminClient();
    const user = await requireUser(request, client);
    const { data: actor, error: actorError } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (actorError || actor?.role !== "admin") return jsonResponse({ error: "Administrator access is required." }, 403, request);

    let body: { invitationId?: string; invitation_id?: string };
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Request body must be a JSON object." }, 400, request);
      body = parsed as { invitationId?: string; invitation_id?: string };
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400, request);
    }
    const invitationId = (typeof body.invitationId === "string" ? body.invitationId : body.invitation_id)?.trim() ?? "";
    if (!isUuid(invitationId)) return jsonResponse({ error: "A valid invitation ID is required." }, 400, request);

    const { data: invitation, error: invitationError } = await client
      .from("dressmaker_invitations")
      .select("id, accepted_at, revoked_at, expires_at")
      .eq("id", invitationId)
      .maybeSingle();
      if (invitationError) return jsonResponse({ error: "The invitation could not be found." }, 400, request);
      if (!invitation) return jsonResponse({ error: "Invitation not found." }, 404, request);
      if (invitation.accepted_at) return jsonResponse({ error: "Accepted invitations cannot be removed." }, 409, request);

    const { error: removeError } = await client
      .from("dressmaker_invitations")
      .delete()
      .eq("id", invitationId)
      .is("accepted_at", null);
      if (removeError) return jsonResponse({ error: "The invitation could not be removed." }, 400, request);

    const { data: current, error: currentError } = await client
      .from("dressmaker_invitations")
      .select("accepted_at, revoked_at, expires_at")
      .eq("id", invitationId)
      .maybeSingle();
      if (currentError) return jsonResponse({ error: "The invitation could not be removed." }, 400, request);
      if (!current) return jsonResponse({ removed: true }, 200, request);
      if (current.accepted_at) return jsonResponse({ error: "Accepted invitations cannot be removed." }, 409, request);
    return jsonResponse({ error: "The invitation could not be removed. Please try again." }, 409, request);
  } catch (error) {
    return jsonResponse({ error: error instanceof AuthRequiredError ? error.message : "Invitation revocation failed." }, error instanceof AuthRequiredError ? 401 : 500, request);
  }
});
