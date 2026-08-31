import fs from "node:fs";
import path from "node:path";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function mobilePublicAssets() {
  const assets = [
    "favicon.svg",
    "manifest.webmanifest",
    "media/3d-body-scan-reference-v3.png",
  ];
  return {
    name: "sukatai-mobile-public-assets",
    closeBundle() {
      for (const relativePath of assets) {
        const source = path.resolve("public", relativePath);
        const destination = path.resolve("dist-mobile", relativePath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    plugins: [react(), ...(mode === "mobile" ? [mobilePublicAssets()] : [])],
    base: mode === "xampp" ? "./" : "/",
    build: {
      outDir: mode === "node" ? "dist-node" : mode === "mobile" ? "dist-mobile" : "dist",
      copyPublicDir: mode !== "mobile",
    },
    define: {
      "import.meta.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
      "import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
    },
    server: {
      port: 5173,
      host: "127.0.0.1",
    },
  };
});
