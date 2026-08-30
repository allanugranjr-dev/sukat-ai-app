import type { Session } from "@supabase/supabase-js";
import { isNodeMode, isXamppMode } from "./supabase";
import {
  nodeRequest,
  notifyNodeAuthStateChange,
  resolveNodeApiUrl,
  subscribeToNodeAuthState,
  type NodeRequestOptions,
} from "./nodeApi";

type XamppRequestOptions = NodeRequestOptions & {
  method?: "GET" | "POST";
  body?: unknown;
  formData?: FormData;
};

type XamppResponse<T> = {
  ok: boolean;
  data?: T;
  message?: string;
};

export type XamppAuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";

const authListeners = new Set<(event: XamppAuthEvent, session: Session | null) => void>();

export function resolveXamppApiUrl(): string {
  if (isNodeMode) return resolveNodeApiUrl();
  const configured = (import.meta.env.VITE_XAMPP_API_URL ?? "").trim();
  if (configured) return new URL(configured, window.location.href).toString();
  return new URL("api/index.php", new URL("./", window.location.href)).toString();
}

export async function xamppRequest<T>(action: string, options: XamppRequestOptions = {}): Promise<T> {
  if (isNodeMode) return nodeRequest<T>(action, options);
  if (!isXamppMode) throw new Error("The XAMPP backend is not enabled for this build.");
  const endpoint = new URL(resolveXamppApiUrl(), window.location.href);
  endpoint.searchParams.set("action", action);
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(endpoint, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    credentials: "include",
  });
  const payload = await response.json().catch(() => null) as XamppResponse<T> | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? `The XAMPP API returned HTTP ${response.status}.`);
  }
  return payload.data as T;
}

export function notifyXamppAuthStateChange(event: XamppAuthEvent, session: Session | null): void {
  if (isNodeMode) {
    notifyNodeAuthStateChange(event, session);
    return;
  }
  authListeners.forEach((listener) => listener(event, session));
}

export function subscribeToXamppAuthState(listener: (event: XamppAuthEvent, session: Session | null) => void): () => void {
  if (isNodeMode) return subscribeToNodeAuthState(listener);
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}
