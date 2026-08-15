import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Assets are served from Laravel's docroot at /app/. Router paths are
  // unaffected — this only rewrites asset URLs.
  base: '/app/',
  build: {
    // Build straight into the Laravel public dir so `medbridge.test` serves the
    // SPA. Scoped to the `app/` subfolder so emptying it never touches
    // Laravel's own index.php / .htaccess.
    outDir: '../public/app',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // React and the router change rarely — split them so app code
        // invalidates on its own. There was a `charts: ['recharts']` chunk
        // here too; the Analytics page that used it is gone, and the entry
        // built down to an empty 0.4 kB stub.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // The frontend NEVER talks to an LLM directly. It only calls the backend
    // REST surface, which is the sole owner of the Hermes AI agent.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
