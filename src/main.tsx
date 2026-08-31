import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { invitationAppOrigin } from "./lib/supabase";
import "./styles.css";

function redirectLegacyLocalInvitation(): boolean {
  const current = new URL(window.location.href);
  const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(current.hostname);
  const authHash = new URLSearchParams(current.hash.replace(/^#/, ""));
  const isExpiredEmailCallback = authHash.get("error_code") === "otp_expired" && authHash.get("error") === "access_denied";
  const isAuthCallback = current.searchParams.has("invite") || current.searchParams.has("token") || authHash.get("type") === "invite" || authHash.get("type") === "recovery" || isExpiredEmailCallback;
  if (!isLocalHost || !isAuthCallback) return false;

  const destination = new URL(`${current.pathname}${current.search}${current.hash}`, invitationAppOrigin());
  if (destination.origin === current.origin) return false;
  window.location.replace(destination.toString());
  return true;
}

if (!redirectLegacyLocalInvitation()) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
