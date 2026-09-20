/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BAIDU_BROWSER_AK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
