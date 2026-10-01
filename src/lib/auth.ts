import { type AuthResponse, type Session, type User } from "./supabase";
import { notifyXamppAuthStateChange, subscribeToXamppAuthState, xamppRequest } from "./xampp";
import type { Invitation, Notification, Organization, Profile, Role } from "./types";

export type VerificationInfo = { email: string; expires_in_seconds: number; delivery: string; dev_code?: string };

type XamppAuthPayload = { session: Session; user: User };

// Sign-in / sign-up can now return a null session when the account still needs
// email verification, in which case a `verification` payload is present.
type AuthOrVerification = { session: Session | null; user: User; verification?: VerificationInfo };

function xamppAuthResponse(payload: { session: Session | null; user: User }): AuthResponse {
  return { data: { session: payload.session, user: payload.user }, error: null } as AuthResponse;
}

export async function getSession(): Promise<Session | null> {
  return xamppRequest<Session | null>("session");
}

export function onAuthStateChange(callback: (event: string, session: Session | null) => void): () => void {
  return subscribeToXamppAuthState((event, session) => callback(event, session));
}

export async function getProfile(userId: string): Promise<Profile> {
  void userId;
  return xamppRequest<Profile>("profile");
}

export async function signIn(email: string, password: string): Promise<AuthResponse & { verification?: VerificationInfo }> {
  const payload = await xamppRequest<AuthOrVerification>("sign_in", { body: { email: email.trim(), password } });
  if (payload.session) notifyXamppAuthStateChange("SIGNED_IN", payload.session);
  return { ...xamppAuthResponse({ session: payload.session, user: payload.user }), verification: payload.verification };
}

export async function signUpCustomer(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<AuthResponse & { verification?: VerificationInfo }> {
  const payload = await xamppRequest<AuthOrVerification>("sign_up", {
    body: {
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      email: input.email.trim(),
      password: input.password,
    },
  });
  if (payload.session) notifyXamppAuthStateChange("SIGNED_IN", payload.session);
  return { ...xamppAuthResponse({ session: payload.session, user: payload.user }), verification: payload.verification };
}

export async function verifyEmailOtp(email: string, code: string): Promise<AuthResponse> {
  const payload = await xamppRequest<XamppAuthPayload>("verify_otp", { body: { email: email.trim(), code: code.trim() } });
  notifyXamppAuthStateChange("SIGNED_IN", payload.session);
  return xamppAuthResponse(payload);
}

export async function resendSignupConfirmation(email: string): Promise<VerificationInfo | null> {
  const payload = await xamppRequest<{ ok?: boolean; verification?: VerificationInfo }>("resend_otp", { body: { email: email.trim() } });
  return payload.verification ?? null;
}

// Step 1 of the reset flow: request a 6-digit code by email. The response uses
// the same anti-enumeration shape as resend_otp — always `ok` with a
// verification payload (dev_code only when the mailer is unconfigured outside
// production), never revealing whether the account exists.
export async function requestPasswordReset(email: string): Promise<VerificationInfo | null> {
  const payload = await xamppRequest<{ ok?: boolean; verification?: VerificationInfo }>("password_reset_request", {
    body: { email: email.trim() },
  });
  return payload.verification ?? null;
}

// Step 2: submit the code + new password. On success the server sets the new
// password, marks the email verified, and signs the user in — so we broadcast
// SIGNED_IN just like verify_otp.
export async function confirmPasswordReset(email: string, code: string, password: string): Promise<AuthResponse> {
  const payload = await xamppRequest<XamppAuthPayload>("password_reset_confirm", {
    body: { email: email.trim(), code: code.trim(), password },
  });
  notifyXamppAuthStateChange("SIGNED_IN", payload.session);
  return xamppAuthResponse(payload);
}

// Session-based password change, used by the dressmaker invitation acceptance
// flow where the user is already signed in. The forgot-password path uses
// requestPasswordReset + confirmPasswordReset instead.
export async function updatePassword(password: string): Promise<User> {
  return xamppRequest<User>("password_update", { body: { password } });
}

export async function signOut(): Promise<void> {
  await xamppRequest("sign_out", { body: {} });
  notifyXamppAuthStateChange("SIGNED_OUT", null);
}

export async function updateProfile(
  userId: string,
  updates: Pick<Profile, "first_name" | "last_name" | "phone" | "email_notifications" | "sms_notifications" | "unit_system">,
): Promise<Profile> {
  void userId;
  return xamppRequest<Profile>("profile_update", { body: updates });
}

export async function assignProfileOrganization(profileId: string, organizationId: string | null): Promise<Profile> {
  return xamppRequest<Profile>("assign_profile_organization", { body: { profile_id: profileId, organization_id: organizationId } });
}

export async function getNotifications(userId: string): Promise<Notification[]> {
  void userId;
  return xamppRequest<Notification[]>("notifications");
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await xamppRequest("mark_notification_read", { body: { notification_id: notificationId } });
}

export async function listOrganizations(): Promise<Organization[]> {
  return xamppRequest<Organization[]>("organizations");
}

export async function listInvitations(): Promise<Invitation[]> {
  return xamppRequest<Invitation[]>("invitations");
}

export async function inviteDressmaker(input: {
  email: string;
  organizationId: string;
  redirectTo: string;
}): Promise<{ invitationId: string; inviteUrl: string | null; emailStatus: string; emailError: string | null }> {
  const payload = await xamppRequest<{ invitation_id: string; invite_url?: string; email_status?: string; email_error?: string | null }>("invite_dressmaker", {
    body: { email: input.email.trim(), organization_id: input.organizationId, redirect_to: input.redirectTo },
  });
  return { invitationId: payload.invitation_id, inviteUrl: payload.invite_url ?? null, emailStatus: payload.email_status ?? "not_configured", emailError: payload.email_error ?? null };
}

export async function revokeDressmakerInvitation(invitationId: string): Promise<void> {
  const id = invitationId.trim();
  if (!id) throw new Error("A valid invitation ID is required.");
  await xamppRequest("revoke_dressmaker_invitation", { body: { invitation_id: id } });
}

export async function acceptDressmakerInvitation(input: {
  token?: string;
  firstName: string;
  lastName: string;
}): Promise<void> {
  const payload = await xamppRequest<{ accepted?: boolean }>("accept_dressmaker_invitation", {
    body: { token: input.token, first_name: input.firstName.trim(), last_name: input.lastName.trim() },
  });
  if (!payload.accepted) throw new Error("This invitation could not be accepted.");
}

export function isRole(value: unknown): value is Role {
  return value === "customer" || value === "dressmaker" || value === "admin";
}
