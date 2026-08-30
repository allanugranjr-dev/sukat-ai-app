import type { AuthResponse, Session, User } from "@supabase/supabase-js";
import { isLocalApiMode, publicAppOrigin, requireSupabase, readableError } from "./supabase";
import { notifyXamppAuthStateChange, subscribeToXamppAuthState, xamppRequest } from "./xampp";
import type { Invitation, Notification, Organization, Profile, Role } from "./types";

type XamppAuthPayload = { session: Session; user: User };

function xamppAuthResponse(payload: XamppAuthPayload): AuthResponse {
  return { data: { session: payload.session, user: payload.user }, error: null } as AuthResponse;
}

export async function getSession(): Promise<Session | null> {
  if (isLocalApiMode) return xamppRequest<Session | null>("session");
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw new Error(readableError(error));
  return data.session;
}

export function onAuthStateChange(callback: (event: string, session: Session | null) => void): () => void {
  if (isLocalApiMode) return subscribeToXamppAuthState((event, session) => callback(event, session));
  const { data } = requireSupabase().auth.onAuthStateChange((event, nextSession) => callback(event, nextSession));
  return () => data.subscription.unsubscribe();
}

export async function getProfile(userId: string): Promise<Profile> {
  if (isLocalApiMode) {
    void userId;
    return xamppRequest<Profile>("profile");
  }
  const { data, error } = await requireSupabase().from("profiles").select("*").eq("id", userId).single();
  if (error) throw new Error(readableError(error));
  return data as Profile;
}

export async function signIn(email: string, password: string): Promise<AuthResponse> {
  if (isLocalApiMode) {
    const payload = await xamppRequest<XamppAuthPayload>("sign_in", { body: { email: email.trim(), password } });
    notifyXamppAuthStateChange("SIGNED_IN", payload.session);
    return xamppAuthResponse(payload);
  }
  const response = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (response.error) throw new Error(readableError(response.error));
  return response;
}

export async function signUpCustomer(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<AuthResponse> {
  if (isLocalApiMode) {
    const payload = await xamppRequest<XamppAuthPayload>("sign_up", {
      body: {
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        email: input.email.trim(),
        password: input.password,
      },
    });
    notifyXamppAuthStateChange("SIGNED_IN", payload.session);
    return xamppAuthResponse(payload);
  }
  const response = await requireSupabase().auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      emailRedirectTo: `${publicAppOrigin()}/?verify=1`,
      data: {
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
      },
    },
  });
  if (response.error) throw new Error(readableError(response.error));
  return response;
}

export async function resendSignupConfirmation(email: string): Promise<void> {
  if (isLocalApiMode) {
    throw new Error("Local mode does not send verification emails. Sign in with your local account instead.");
  }
  const { error } = await requireSupabase().auth.resend({
    type: "signup",
    email: email.trim(),
    options: {
      emailRedirectTo: `${publicAppOrigin()}/?verify=1`,
    },
  });
  if (error) throw new Error(readableError(error));
}

export async function sendPasswordReset(email: string): Promise<void> {
  if (isLocalApiMode) {
    await xamppRequest("password_reset_request", { body: { email: email.trim() } });
    return;
  }
  const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${publicAppOrigin()}/?reset=1`,
  });
  if (error) throw new Error(readableError(error));
}

export async function updatePassword(password: string): Promise<User> {
  if (isLocalApiMode) return xamppRequest<User>("password_update", { body: { password } });
  const { data, error } = await requireSupabase().auth.updateUser({ password });
  if (error) throw new Error(readableError(error));
  return data.user;
}

export async function signOut(): Promise<void> {
  if (isLocalApiMode) {
    await xamppRequest("sign_out", { body: {} });
    notifyXamppAuthStateChange("SIGNED_OUT", null);
    return;
  }
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw new Error(readableError(error));
}

export async function updateProfile(
  userId: string,
  updates: Pick<Profile, "first_name" | "last_name" | "phone" | "email_notifications" | "sms_notifications" | "unit_system">,
): Promise<Profile> {
  if (isLocalApiMode) {
    void userId;
    return xamppRequest<Profile>("profile_update", { body: updates });
  }
  const { data, error } = await requireSupabase().from("profiles").update(updates).eq("id", userId).select("*").single();
  if (error) throw new Error(readableError(error));
  return data as Profile;
}

export async function assignProfileOrganization(profileId: string, organizationId: string | null): Promise<Profile> {
  if (isLocalApiMode) return xamppRequest<Profile>("assign_profile_organization", { body: { profile_id: profileId, organization_id: organizationId } });
  const { data, error } = await requireSupabase().from("profiles").update({ organization_id: organizationId }).eq("id", profileId).select("*").single();
  if (error) throw new Error(readableError(error));
  return data as Profile;
}

export async function getNotifications(userId: string): Promise<Notification[]> {
  if (isLocalApiMode) {
    void userId;
    return xamppRequest<Notification[]>("notifications");
  }
  const { data, error } = await requireSupabase()
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(readableError(error));
  return (data ?? []) as Notification[];
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  if (isLocalApiMode) {
    await xamppRequest("mark_notification_read", { body: { notification_id: notificationId } });
    return;
  }
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(readableError(userError ?? new Error("Authentication is required.")));
  const { error } = await client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId).eq("user_id", userData.user.id);
  if (error) throw new Error(readableError(error));
}

export async function listOrganizations(): Promise<Organization[]> {
  if (isLocalApiMode) return xamppRequest<Organization[]>("organizations");
  const { data, error } = await requireSupabase().from("organizations").select("*").order("name");
  if (error) throw new Error(readableError(error));
  return (data ?? []) as Organization[];
}

export async function listInvitations(): Promise<Invitation[]> {
  if (isLocalApiMode) return xamppRequest<Invitation[]>("invitations");
  const { data, error } = await requireSupabase()
    .from("dressmaker_invitations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(readableError(error));
  return (data ?? []) as Invitation[];
}

export async function inviteDressmaker(input: {
  email: string;
  organizationId: string;
  redirectTo: string;
}): Promise<{ invitationId: string; inviteUrl: string | null; emailStatus: string; emailError: string | null }> {
  if (isLocalApiMode) {
    const payload = await xamppRequest<{ invitation_id: string; invite_url?: string; email_status?: string; email_error?: string | null }>("invite_dressmaker", {
      body: { email: input.email.trim(), organization_id: input.organizationId, redirect_to: input.redirectTo },
    });
    return { invitationId: payload.invitation_id, inviteUrl: payload.invite_url ?? null, emailStatus: payload.email_status ?? "not_configured", emailError: payload.email_error ?? null };
  }
  const { data, error } = await requireSupabase().functions.invoke("invite-dressmaker", {
    body: input,
  });
  if (error) throw new Error(readableError(error));
  const payload = data as { invitation_id?: string; invite_url?: string } | null;
  if (!payload?.invitation_id) throw new Error("The invitation service returned an incomplete response.");
  return { invitationId: payload.invitation_id, inviteUrl: payload.invite_url ?? null, emailStatus: "sent", emailError: null };
}

export async function acceptDressmakerInvitation(input: {
  token: string;
  firstName: string;
  lastName: string;
}): Promise<void> {
  if (isLocalApiMode) {
    const payload = await xamppRequest<{ accepted?: boolean }>("accept_dressmaker_invitation", {
      body: { token: input.token, first_name: input.firstName.trim(), last_name: input.lastName.trim() },
    });
    if (!payload.accepted) throw new Error("This invitation could not be accepted.");
    return;
  }
  const { data, error } = await requireSupabase().functions.invoke("accept-dressmaker-invitation", {
    body: input,
  });
  if (error) throw new Error(readableError(error));
  if (!(data as { accepted?: boolean } | null)?.accepted) {
    throw new Error("This invitation could not be accepted.");
  }
}

export function isRole(value: unknown): value is Role {
  return value === "customer" || value === "dressmaker" || value === "admin";
}
