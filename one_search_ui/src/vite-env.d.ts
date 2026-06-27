/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGUI_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
