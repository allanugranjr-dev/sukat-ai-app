import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(serverDirectory, "..");
export const canonicalAppUrl = "http://127.0.0.1:5173";

// Load the Node-specific files without touching the existing Supabase/XAMPP env files.
for (const fileName of [".env.node", ".env.node.local"]) {
  dotenv.config({ path: path.join(projectRoot, fileName), override: false, quiet: true });
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function listEnv(name, fallback) {
  const value = (process.env[name] ?? "").trim();
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
// Treat the deployment as production when EITHER the standard NODE_ENV or the
// app's own SUKATAI_ENV/APP_ENV convention says so. The PHP mirror keys its
// production flag off SUKATAI_ENV/APP_ENV, so honoring them here keeps the two
// runtimes in the same mode and prevents the dev-code reveal from leaking in a
// production deployment that only set the app-conventional variable.
const explicitEnv = (process.env.SUKATAI_ENV ?? process.env.APP_ENV ?? "").trim().toLowerCase();
const isProduction = nodeEnv === "production" || explicitEnv === "production";

// Localhost development origins are only trusted outside production. In a
// production deployment the credentialed CORS allowlist must be limited to the
// explicit origins configured through SUKATAI_WEB_ORIGINS.
const localDevOrigins = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5174",
  "http://localhost:5174",
  "http://127.0.0.1:3001",
  "http://localhost:3001",
  "http://127.0.0.1:3002",
  "http://localhost:3002",
];

export const config = {
  nodeEnv,
  isProduction,
  port: numberEnv("PORT", 3001),
  db: {
    host: process.env.SUKATAI_DB_HOST ?? "127.0.0.1",
    port: numberEnv("SUKATAI_DB_PORT", 3306),
    name: process.env.SUKATAI_DB_NAME ?? "sukatai",
    user: process.env.SUKATAI_DB_USER ?? "root",
    password: process.env.SUKATAI_DB_PASS ?? "",
    connectionLimit: numberEnv("SUKATAI_DB_CONNECTION_LIMIT", 10),
  },
  storageDirectory: path.resolve(projectRoot, process.env.SUKATAI_STORAGE_DIR ?? "xampp/storage"),
  distDirectory: path.join(projectRoot, "dist-node"),
  publicDirectory: path.join(projectRoot, "public"),
  reconstruction: {
    // The only built-in scanner is the CPU-only Anny + CLAD service. An
    // absent provider must fail clearly rather than select a sample template.
    provider: (process.env.RECONSTRUCTION_PROVIDER ?? "ai-service").trim().toLowerCase(),
    apiUrl: (process.env.RECONSTRUCTION_API_URL ?? process.env.AI_SERVICE_URL ?? "").trim().replace(/\/$/, ""),
    apiKey: (process.env.RECONSTRUCTION_API_KEY ?? process.env.AI_SERVICE_API_KEY ?? "").trim(),
    // CPU-only Anny fitting can take several minutes on the supported
    // low-end laptop. Keep the gateway alive long enough to receive the
    // provider result; deployments can still override this value.
    timeoutMs: numberEnv("RECONSTRUCTION_TIMEOUT_MS", 600000),
    maxModelBytes: numberEnv("RECONSTRUCTION_MAX_MODEL_BYTES", 25 * 1024 * 1024),
  },
  sessionHours: numberEnv("SUKATAI_SESSION_HOURS", 24),
  notifications: {
    // Provider auto-selection: an explicit SUKATAI_EMAIL_PROVIDER wins; otherwise
    // pick smtp when SMTP creds are present, then resend when a key is present,
    // else the console no-op (which surfaces the OTP dev code on screen).
    emailProvider: (process.env.SUKATAI_EMAIL_PROVIDER
      ?? (process.env.SUKATAI_SMTP_HOST && process.env.SUKATAI_SMTP_USER && process.env.SUKATAI_SMTP_PASS
        ? "smtp"
        : process.env.RESEND_API_KEY ? "resend" : "console")).trim().toLowerCase(),
    emailApiKey: (process.env.RESEND_API_KEY ?? "").trim(),
    emailFrom: (process.env.SUKATAI_EMAIL_FROM ?? "SukatAI <onboarding@resend.dev>").trim(),
    smtp: {
      host: (process.env.SUKATAI_SMTP_HOST ?? "").trim(),
      port: numberEnv("SUKATAI_SMTP_PORT", 587),
      user: (process.env.SUKATAI_SMTP_USER ?? "").trim(),
      pass: (process.env.SUKATAI_SMTP_PASS ?? "").trim(),
      // Gmail on 587 uses STARTTLS (secure:false + upgrade); 465 uses implicit TLS.
      secure: process.env.SUKATAI_SMTP_SECURE === "true"
        ? true
        : process.env.SUKATAI_SMTP_SECURE === "false"
          ? false
          : numberEnv("SUKATAI_SMTP_PORT", 587) === 465,
    },
    smsProvider: (process.env.SUKATAI_SMS_PROVIDER ?? (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? "twilio" : "console")).trim().toLowerCase(),
    twilioAccountSid: (process.env.TWILIO_ACCOUNT_SID ?? "").trim(),
    twilioAuthToken: (process.env.TWILIO_AUTH_TOKEN ?? "").trim(),
    twilioFromNumber: (process.env.TWILIO_FROM_NUMBER ?? "").trim(),
    publicAppUrl: (process.env.SUKATAI_PUBLIC_APP_URL ?? canonicalAppUrl).trim().replace(/\/$/, ""),
  },
  allowedOrigins: listEnv(
    "SUKATAI_WEB_ORIGINS",
    isProduction ? [canonicalAppUrl] : [canonicalAppUrl, ...localDevOrigins],
  ),
  // The session cookie must ship with Secure in production so it is never sent
  // over plaintext HTTP. It can be forced on/off explicitly, but the safe
  // default outside development is enabled.
  cookieSecure:
    process.env.SUKATAI_COOKIE_SECURE === "true"
      ? true
      : process.env.SUKATAI_COOKIE_SECURE === "false"
        ? false
        : isProduction,
  cookieSameSite: process.env.SUKATAI_COOKIE_SAMESITE === "None" ? "None" : "Lax",
  // The X-Forwarded-For header is client-controlled and only trustworthy when a
  // reverse proxy that overwrites it sits in front of this process. Default OFF
  // so a directly-exposed server keys rate limits on the real socket address; a
  // deployment behind a trusted proxy sets SUKATAI_TRUST_PROXY=true.
  trustProxy: process.env.SUKATAI_TRUST_PROXY === "true",
};

// A production deployment must never fall back to the passwordless root
// default. Fail fast so a misconfigured environment cannot expose the database
// with well-known credentials.
if (isProduction && !config.db.password) {
  throw new Error(
    "Refusing to start in production without an explicit SUKATAI_DB_PASS. " +
      "Configure a least-privilege database account and password.",
  );
}

export function safeDatabaseIdentifier(value) {
  if (!/^[a-zA-Z0-9_$-]+$/.test(value)) throw new Error("Invalid database identifier.");
  return `\`${value.replaceAll("`", "``")}\``;
}
