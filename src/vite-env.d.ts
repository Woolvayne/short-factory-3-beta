/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** SHA-256 of the gate password — recommended. Set in Vercel → Environment Variables. */
  readonly VITE_APP_PASSWORD_HASH?: string;
  /** Plaintext gate password — simple fallback, less secure. */
  readonly VITE_APP_PASSWORD?: string;
  /** Legacy v1 (Supabase) — unused by the current factory. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
