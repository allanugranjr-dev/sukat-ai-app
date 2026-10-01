import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  return {
    plugins: [react()],
    base: mode === "xampp" ? "./" : "/",
    build: {
      outDir: mode === "node" ? "dist-node" : "dist",
    },
    server: {
      port: 5173,
      host: "127.0.0.1",
    },
  };
});
