import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['.smpn3kotaserang.sch.id', 'clipper.smpn3kotaserang.sch.id'],
    cors: true,
    watch: {
      ignored: ['**/dist_app/**', '**/dist_installer/**', '**/build/**', '**/venv/**', '**/.runtime/**', '**/temp_clips/**', '**/exports/**', '**/logs/**']
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/redoc': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/openapi.json': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    }
  }
})
