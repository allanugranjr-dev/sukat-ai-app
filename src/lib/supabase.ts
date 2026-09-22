// Local-only backend boundary.
//
// SukatAI previously supported a hosted Supabase runtime alongside the local
// Node.js / XAMPP API. The Supabase path has been removed — the app now always
// talks to the local API adapter. This module keeps the small set of exports
// the rest of the app depends on (backend-mode flags, origin helpers, error
// formatting, and the auth type shims that used to come from
// @supabase/supabase-js) so no other file needs a dependency on the SDK.

const canonicalAppOrigin = "http://127.0.0.1:5173";

// The app runs against the local Node.js / XAMPP API in every build now.
// `xampp` mode targets the PHP runtime; anything else uses the Node runtime.
const configuredBackendMode = (import.meta.env.VITE_BACKEND_MODE ?? "").trim().toLowerCase();
const backendMode = configuredBackendMode === "xampp" ? "xampp" : "node";

export const isXamppMode = backendMode === "xampp";
export const isNodeMode = backendMode === "node";
export const isLocalApiMode = true;

// Minimal auth type shims. These replace the shapes the app used from
// @supabase/supabase-js; only the fields the UI and adapters actually read are
// modelled here.
export type User = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type Session = {
  user: User;
  access_token?: string;
  [key: string]: unknown;
};

export type AuthResponse = {
  data: { session: Session | null; user: User | null };
  error: null;
};

export const supabaseConfig = {
  mode: backendMode,
  isConfigured: true as const,
};

export function publicAppOrigin(): string {
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL ?? "").trim();
  if (configured) {
    try {
      return new URL(configured, window.location.origin).origin;
    } catch {
      // Fall back to the current origin when a deployment variable is malformed.
    }
  }
  return window.location.origin;
}

export function invitationAppOrigin(): string {
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL ?? "").trim();
  if (configured) {
    try {
      return new URL(configured, window.location.origin).origin;
    } catch {
      // Fall back to the production alias when a deployment variable is malformed.
    }
  }
  return canonicalAppOrigin;
}

export function readableError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Something went wrong. Please try again.";
}
