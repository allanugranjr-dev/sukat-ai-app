import { describe, expect, it } from "vitest";
import { invitationState, isRevocableInvitation } from "../src/lib/invitationLifecycle";

const activeExpiry = "2026-09-01T00:00:00.000Z";
const now = Date.parse("2026-08-31T00:00:00.000Z");

describe("invitation lifecycle", () => {
  it("only allows an unexpired pending invitation to be removed", () => {
    const invitation = { accepted_at: null, revoked_at: null, expires_at: activeExpiry };
    expect(invitationState(invitation, now)).toBe("Pending");
    expect(isRevocableInvitation(invitation, now)).toBe(true);
  });

  it("keeps accepted, revoked, and expired invitations protected", () => {
    const accepted = { accepted_at: "2026-08-30T00:00:00.000Z", revoked_at: null, expires_at: activeExpiry };
    const revoked = { accepted_at: null, revoked_at: "2026-08-30T00:00:00.000Z", expires_at: activeExpiry };
    const expired = { accepted_at: null, revoked_at: null, expires_at: "2026-08-30T00:00:00.000Z" };
    for (const invitation of [accepted, revoked, expired]) {
      expect(isRevocableInvitation(invitation, now)).toBe(false);
    }
    expect(invitationState(accepted, now)).toBe("Accepted");
    expect(invitationState(revoked, now)).toBe("Revoked");
    expect(invitationState(expired, now)).toBe("Expired");
  });
});
