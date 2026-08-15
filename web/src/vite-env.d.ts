/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_REALTIME_TRANSPORT?: 'sse' | 'ws' | 'mock'
  readonly VITE_USE_MOCKS?: string
  readonly VITE_API_TIMEOUT_MS?: string
  readonly VITE_SUPPORT_PHONE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
