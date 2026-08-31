import { io, type Socket } from "socket.io-client";
import type { Session } from "@supabase/supabase-js";
import { isNodeMode } from "./supabase";

export type NodeRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  formData?: FormData;
  timeoutMs?: number;
};

type NodeResponse<T> = {
  ok: boolean;
  data?: T;
  message?: string;
};

export type NodeAuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";

export type NodeScanStatusEvent = {
  scanId: string;
  status: string;
  message: string;
  updatedAt: string;
};

const authListeners = new Set<(event: NodeAuthEvent, session: Session | null) => void>();

export function resolveNodeApiUrl(): string {
  const configured = (import.meta.env.VITE_NODE_API_URL ?? "").trim();
  if (configured) return new URL(configured, window.location.href).toString();
  if (import.meta.env.DEV) return "http://127.0.0.1:3001/api";
  return new URL("/api", window.location.origin).toString();
}

export function resolveNodeSocketUrl(): string {
  return new URL(resolveNodeApiUrl(), window.location.href).origin;
}

export async function nodeRequest<T>(action: string, options: NodeRequestOptions = {}): Promise<T> {
  if (!isNodeMode) throw new Error("The Node.js backend is not enabled for this build.");
  const endpoint = new URL(resolveNodeApiUrl(), window.location.href);
  endpoint.searchParams.set("action", action);
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetch(endpoint, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      credentials: "include",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as NodeResponse<T> | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message ?? ("The Node.js API returned HTTP " + response.status + "."));
    }
    return payload.data as T;
  } catch (reason: unknown) {
    if (controller.signal.aborted) throw new Error("The Node.js API did not respond in time. Check that the local server is running and try again.");
    throw reason;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function notifyNodeAuthStateChange(event: NodeAuthEvent, session: Session | null): void {
  authListeners.forEach((listener) => listener(event, session));
}

export function subscribeToNodeAuthState(listener: (event: NodeAuthEvent, session: Session | null) => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

export function subscribeToNodeScan(
  scanId: string,
  onStatus: (event: NodeScanStatusEvent) => void,
  onError?: (message: string) => void,
): () => void {
  if (!isNodeMode) return () => undefined;
  const socket: Socket = io(resolveNodeSocketUrl(), {
    withCredentials: true,
    transports: ["websocket", "polling"],
  });
  const handleStatus = (event: NodeScanStatusEvent) => {
    if (event.scanId === scanId) onStatus(event);
  };
  const handleConnectError = (error: Error) => onError?.(error.message || "Live scan updates are unavailable.");
  socket.on("scan:status", handleStatus);
  socket.on("connect_error", handleConnectError);
  socket.on("connect", () => {
    socket.emit("scan:join", { scanId }, (response: { ok?: boolean; message?: string }) => {
      if (response?.ok === false) onError?.(response.message ?? "You cannot subscribe to this scan.");
    });
  });
  return () => {
    socket.emit("scan:leave", { scanId });
    socket.off("scan:status", handleStatus);
    socket.off("connect_error", handleConnectError);
    socket.disconnect();
  };
}
