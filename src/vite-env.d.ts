/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly VITE_BACKEND_MODE?: string;
  readonly VITE_NODE_API_URL?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly NEXT_PUBLIC_SUPABASE_URL: string;
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  readonly RECONSTRUCTION_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
