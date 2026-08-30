import { adminClient, AuthRequiredError, requireUser } from "../_shared/auth.ts";
import { jsonResponse, optionsResponse } from "../_shared/cors.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to remove an invitation." }, 405);
  try {
    const client = adminClient();
    const user = await requireUser(request, client);
    const { data: actor, error: actorError } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (actorError || actor?.role !== "admin") return jsonResponse({ error: "Administrator access is required." }, 403);

    let body: { invitationId?: string; invitation_id?: string };
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Request body must be a JSON object." }, 400);
      body = parsed as { invitationId?: string; invitation_id?: string };
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
    const invitationId = (typeof body.invitationId === "string" ? body.invitationId : body.invitation_id)?.trim() ?? "";
    if (!isUuid(invitationId)) return jsonResponse({ error: "A valid invitation ID is required." }, 400);

    const { data: invitation, error: invitationError } = await client
      .from("dressmaker_invitations")
      .select("id, accepted_at, revoked_at, expires_at")
      .eq("id", invitationId)
      .maybeSingle();
    if (invitationError) return jsonResponse({ error: invitationError.message }, 400);
    if (!invitation) return jsonResponse({ error: "Invitation not found." }, 404);
    if (invitation.accepted_at) return jsonResponse({ error: "Accepted invitations cannot be removed." }, 409);

    const { error: removeError } = await client
      .from("dressmaker_invitations")
      .delete()
      .eq("id", invitationId)
      .is("accepted_at", null);
    if (removeError) return jsonResponse({ error: removeError.message }, 400);

    const { data: current, error: currentError } = await client
      .from("dressmaker_invitations")
      .select("accepted_at, revoked_at, expires_at")
      .eq("id", invitationId)
      .maybeSingle();
    if (currentError) return jsonResponse({ error: currentError.message }, 400);
    if (!current) return jsonResponse({ removed: true });
    if (current.accepted_at) return jsonResponse({ error: "Accepted invitations cannot be removed." }, 409);
    return jsonResponse({ error: "The invitation could not be removed. Please try again." }, 409);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invitation revocation failed." }, error instanceof AuthRequiredError ? 401 : 500);
  }
});
