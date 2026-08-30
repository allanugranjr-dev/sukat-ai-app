import type { Invitation } from "./types";

export type InvitationState = "Accepted" | "Revoked" | "Expired" | "Pending";

export function invitationState(invitation: Pick<Invitation, "accepted_at" | "revoked_at" | "expires_at">, now = Date.now()): InvitationState {
  if (invitation.accepted_at) return "Accepted";
  if (invitation.revoked_at) return "Revoked";
  const expiresAt = Date.parse(invitation.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now ? "Pending" : "Expired";
}

export function isRevocableInvitation(invitation: Pick<Invitation, "accepted_at" | "revoked_at" | "expires_at">, now = Date.now()): boolean {
  return invitationState(invitation, now) === "Pending";
}
