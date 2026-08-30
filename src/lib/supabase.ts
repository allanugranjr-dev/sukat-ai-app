import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const anonKey = (import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const configuredBackendMode = (import.meta.env.VITE_BACKEND_MODE ?? "").trim().toLowerCase();
const backendMode = configuredBackendMode || (import.meta.env.MODE === "node" ? "node" : "");

export const isXamppMode = backendMode === "xampp";
export const isNodeMode = backendMode === "node";
export const isLocalApiMode = isXamppMode || isNodeMode;

function isUsableValue(value: string): boolean {
  return value.length > 0 && !/^your[-_]/i.test(value);
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export const supabaseConfig = {
  mode: isXamppMode ? "xampp" : isNodeMode ? "node" : "supabase",
  url,
  anonKey,
  missing: [
    !isValidUrl(url) ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !isUsableValue(anonKey) ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
  ].filter((value): value is string => Boolean(value)),
  get isConfigured() {
    return isLocalApiMode || this.missing.length === 0;
  },
};

export const supabase: SupabaseClient | null = !isLocalApiMode && supabaseConfig.isConfigured
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(isXamppMode ? "SukatAI is running in XAMPP mode. Use the PHP API adapter instead of the Supabase client." : isNodeMode ? "SukatAI is running in Node.js mode. Use the Node API adapter instead of the Supabase client." : "Supabase is not configured. Add the public Supabase URL and anon key before using SukatAI.");
  }
  return supabase;
}

export function readableError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Something went wrong. Please try again.";
}
