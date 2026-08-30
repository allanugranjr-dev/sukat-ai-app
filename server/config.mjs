import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(serverDirectory, "..");

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

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
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
  processingDelayMs: numberEnv("SUKATAI_PROCESSING_DELAY_MS", 900),
  sessionHours: numberEnv("SUKATAI_SESSION_HOURS", 24),
  allowedOrigins: listEnv("SUKATAI_WEB_ORIGINS", [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
  ]),
  cookieSecure: process.env.SUKATAI_COOKIE_SECURE === "true",
  cookieSameSite: process.env.SUKATAI_COOKIE_SAMESITE === "None" ? "None" : "Lax",
};

export function safeDatabaseIdentifier(value) {
  if (!/^[a-zA-Z0-9_$-]+$/.test(value)) throw new Error("Invalid database identifier.");
  return `\`${value.replaceAll("`", "``")}\``;
}
